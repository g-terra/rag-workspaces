"""Fetch one page of a documentation website as clean Markdown, or list a site's pages from its sitemap.

The API crawls a site one URL at a time through this component (flow `rw-fetch`): it keeps the list of
pages to visit, the limits and the pause between requests, and this component does the fetching and
cleaning, so loading stays in Langflow.

- Every request goes through Langflow's SSRF guard: private and internal addresses are refused unless
  their host is in LANGFLOW_SSRF_ALLOWED_HOSTS, and each redirect hop is checked again.
- robots.txt is honoured (cached per site for the life of the worker).
- `page` mode returns the page's main content as Markdown, without navigation, headers, footers and
  sidebars, plus every link on the page (collected before cleaning, since navigation is where links are).
  When the site publishes llms.txt, the page's own Markdown twin (`<url>.md`) is used instead.
- `sitemap` mode reads robots.txt's Sitemap lines, `<scope>sitemap.xml` and `/sitemap.xml`, follows
  sitemap indexes, and returns the page URLs, robots.txt's Crawl-delay and whether llms.txt exists.
"""

import gzip
import re
import sys
import time
import types
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import BoolInput, DropdownInput, Output, StrInput
from lfx.schema.data import Data

USER_AGENT = "rag-workspaces-crawler"
TIMEOUT_SECONDS = 15
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 10
MAX_SITEMAP_FILES = 50
ROBOTS_TTL_SECONDS = 600

# Removed before converting the main content: never the text a reader came for.
DROP_TAGS = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "button",
             "iframe", "template"]
DROP_ROLES = ["navigation", "banner", "contentinfo", "search"]
# class or id fragments of sidebars, tables of contents and other chrome found on docs generators.
DROP_NAMES = re.compile(
    r"(^|[-_\s])(sidebar|toc|table-of-contents|breadcrumbs?|edit-?this-?page|pagination|pager|"
    r"cookie|feedback|skip-?link|on-?this-?page|theme-?toggle|search)([-_\s]|$)",
    re.IGNORECASE,
)
# Mintlify and others start every Markdown twin with a note pointing at llms.txt.
LLMS_NOTE = re.compile(r"\A(?:>[^\n]*\n)*?>[^\n]*llms\.txt[^\n]*\n(?:>[^\n]*\n)*\s*", re.IGNORECASE)

# Kept across runs in one Langflow worker: Langflow rebuilds this module from source on every run, so a
# plain module-level dict would start empty each time (the same trick as chroma_search.py).
_CACHE = sys.modules.setdefault("rag_workspaces_web_cache", types.ModuleType("rag_workspaces_web_cache"))
if not hasattr(_CACHE, "robots"):
    _CACHE.robots = {}


class Blocked(Exception):
    """The SSRF guard refused a URL."""


def _client_for(url: str) -> httpx.Client:
    """A client for one URL's host, DNS-pinned to addresses the SSRF guard approved."""
    from lfx.utils.ssrf_protection import SSRFProtectionError, is_ssrf_protection_enabled, validate_and_resolve_url
    from lfx.utils.ssrf_transport import create_ssrf_protected_sync_client, pin_host_for_url

    try:
        _, ips = validate_and_resolve_url(url)
    except (SSRFProtectionError, ValueError) as e:
        msg = f"refused by Langflow's SSRF guard: {e}"
        raise Blocked(msg) from e
    kwargs = {"timeout": TIMEOUT_SECONDS, "headers": {"User-Agent": USER_AGENT}}
    if is_ssrf_protection_enabled() and ips:
        return create_ssrf_protected_sync_client(hostname=pin_host_for_url(url), validated_ips=ips, **kwargs)
    return httpx.Client(**kwargs)


def http_get(url: str, accept: str = "*/*") -> tuple[int, str, str, bytes]:
    """GET with redirects followed by hand (each hop re-checked). Returns status, final URL, type, body."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        with _client_for(current) as client, client.stream(
            "GET", current, headers={"Accept": accept}, follow_redirects=False
        ) as r:
            location = r.headers.get("location")
            if r.status_code in (301, 302, 303, 307, 308) and location:
                current = urljoin(current, location)
                continue
            body = bytearray()
            for chunk in r.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BODY_BYTES:
                    msg = f"{current} is larger than {MAX_BODY_BYTES // (1024 * 1024)} MB"
                    raise ValueError(msg)
            ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
            return r.status_code, current, ctype, bytes(body)
    msg = f"more than {MAX_REDIRECTS} redirects from {url}"
    raise ValueError(msg)


def decode(body: bytes) -> str:
    return body.decode("utf-8", errors="replace")


def robots_for(url: str) -> RobotFileParser:
    """robots.txt of the URL's site; a missing or unreadable one allows everything."""
    parts = urlparse(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    cached = _CACHE.robots.get(origin)
    if cached and time.monotonic() - cached[0] < ROBOTS_TTL_SECONDS:
        return cached[1]
    parser = RobotFileParser()
    try:
        status, _, _, body = http_get(f"{origin}/robots.txt", "text/plain")
        parser.parse(decode(body).splitlines() if status == 200 else [])
    except (httpx.HTTPError, ValueError, Blocked):
        parser.parse([])
    _CACHE.robots[origin] = (time.monotonic(), parser)
    return parser


def strip_llms_note(markdown: str) -> str:
    return LLMS_NOTE.sub("", markdown, count=1).strip()


def page_links(html: str, base: str) -> tuple[list[str], str | None, str]:
    """Every link on the page (absolute), its canonical URL and its title."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    seen: dict[str, None] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href and not href.startswith(("mailto:", "javascript:", "tel:", "#")):
            seen[urljoin(base, href)] = None
    canonical = None
    link = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    if link and link.get("href"):
        canonical = urljoin(base, link["href"].strip())
    title = soup.title.get_text(strip=True) if soup.title else ""
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        title = h1.get_text(" ", strip=True)
    return list(seen), canonical, title


def main_markdown(html: str) -> str:
    """The page's main content as Markdown, without the site's chrome."""
    import io

    from bs4 import BeautifulSoup
    from markitdown import MarkItDown

    soup = BeautifulSoup(html, "lxml")
    root = soup.find("main") or soup.find("article") or soup.find(attrs={"role": "main"}) or soup.body or soup
    for el in root.find_all(DROP_TAGS):
        el.decompose()
    for el in root.find_all(attrs={"role": DROP_ROLES}):
        el.decompose()
    for el in root.find_all(True):
        if getattr(el, "decomposed", False):
            continue
        attrs = getattr(el, "attrs", None) or {}
        names = " ".join([*(attrs.get("class") or []), attrs.get("id") or ""])
        if names and DROP_NAMES.search(names):
            el.decompose()
    page = f"<html><body>{root}</body></html>"
    result = MarkItDown(enable_plugins=False).convert_stream(io.BytesIO(page.encode("utf-8")), file_extension=".html")
    text = re.sub(r"\n{3,}", "\n\n", result.markdown or "")
    return text.strip()


def sitemap_urls(xml: str) -> tuple[list[str], list[str]]:
    """(page URLs, nested sitemap URLs) of one sitemap or sitemap index."""
    locs = [m.strip() for m in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml)]
    if re.search(r"<sitemapindex[\s>]", xml):
        return [], locs
    return locs, []


class WorkspaceWebPage(Component):
    display_name = "Workspace Web Page"
    description = "Fetch one documentation page as clean Markdown with its links, or list a site's pages from its sitemap."
    icon = "globe"
    name = "WorkspaceWebPage"

    inputs = [
        StrInput(name="url", display_name="URL", info="The page, or in sitemap mode the site's scope URL.",
                 required=True),
        DropdownInput(name="mode", display_name="Mode", options=["page", "sitemap"], value="page"),
        BoolInput(name="prefer_markdown", display_name="Prefer Markdown Twin", value=False,
                  info="Try <url>.md first (sites that publish llms.txt)."),
        BoolInput(name="want_links", display_name="Return Links", value=True,
                  info="Collect the page's links; needs the HTML page."),
    ]
    outputs = [Output(display_name="Result", name="result", method="fetch")]

    def fetch(self) -> Data:
        result = self._sitemap() if self.mode == "sitemap" else self._page()
        self.status = {k: v for k, v in result.items() if k != "markdown"}
        return Data(data=result)

    def _page(self) -> dict:
        url = self.url.strip()
        out = {"url": url, "finalUrl": url, "status": 0, "title": "", "markdown": "", "links": [],
               "canonical": None, "blocked": False, "skipped": None, "error": None}
        try:
            if not robots_for(url).can_fetch(USER_AGENT, url):
                out["blocked"] = True
                return out
            if self.prefer_markdown:
                twin = url.rstrip("/") + ".md"
                status, final, ctype, body = http_get(twin, "text/markdown, text/plain")
                if status == 200 and ctype in ("text/markdown", "text/plain", "text/x-markdown"):
                    out["markdown"] = strip_llms_note(decode(body))
                    out["status"] = 200
                    heading = re.search(r"^#\s+(.+)$", out["markdown"], re.MULTILINE)
                    out["title"] = heading.group(1).strip() if heading else ""
                    if not self.want_links:
                        return out
            status, final, ctype, body = http_get(url, "text/html, text/markdown;q=0.9, text/plain;q=0.8")
            out["status"], out["finalUrl"] = status, final
            if status >= 400:
                out["markdown"] = ""
                return out
            if ctype in ("text/markdown", "text/plain", "text/x-markdown"):
                out["markdown"] = out["markdown"] or decode(body).strip()
                return out
            if ctype not in ("text/html", "application/xhtml+xml"):
                out["skipped"] = ctype or "unknown content type"
                out["markdown"] = ""
                return out
            html = decode(body)
            out["links"], out["canonical"], title = page_links(html, final)
            out["title"] = out["title"] or title
            if not out["markdown"]:
                out["markdown"] = main_markdown(html)
        except Blocked as e:
            out["error"] = str(e)
        except (httpx.HTTPError, ValueError) as e:
            out["error"] = f"{type(e).__name__}: {e}" if not str(e) else str(e)
        return out

    def _sitemap(self) -> dict:
        scope = self.url.strip()
        parts = urlparse(scope)
        origin = f"{parts.scheme}://{parts.netloc}"
        robots = robots_for(scope)
        delay = robots.crawl_delay(USER_AGENT)
        todo = [*(robots.site_maps() or []), urljoin(scope, "sitemap.xml"), f"{origin}/sitemap.xml"]
        seen: set[str] = set()
        urls: dict[str, None] = {}
        errors: list[str] = []
        while todo and len(seen) < MAX_SITEMAP_FILES:
            sm = todo.pop(0)
            if sm in seen:
                continue
            seen.add(sm)
            try:
                status, _, _, body = http_get(sm, "application/xml, text/xml")
            except (httpx.HTTPError, ValueError, Blocked) as e:
                errors.append(f"{sm}: {e}")
                continue
            if status != 200:
                continue
            if sm.endswith(".gz") or body[:2] == b"\x1f\x8b":
                try:
                    body = gzip.decompress(body)
                except OSError:
                    continue
            pages, nested = sitemap_urls(decode(body))
            for p in pages:
                urls[p] = None
            # Nested sitemaps outside the site's origin are not ours to read.
            todo.extend(n for n in nested if n.startswith(origin))
        has_llms = False
        try:
            status, _, ctype, _ = http_get(urljoin(scope, "llms.txt"), "text/plain, text/markdown")
            has_llms = status == 200 and ctype in ("text/plain", "text/markdown")
        except (httpx.HTTPError, ValueError, Blocked):
            pass
        return {"urls": list(urls), "crawlDelay": float(delay) if delay else None, "hasLlmsTxt": has_llms,
                "sitemaps": len(seen), "errors": errors[:5]}
