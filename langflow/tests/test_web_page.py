import gzip

import httpx
import pytest
import respx

from rag_workspaces import web_page
from rag_workspaces.web_page import (
    USER_AGENT,
    Blocked,
    WorkspaceWebPage,
    _client_for,
    decode,
    gunzip,
    main_markdown,
    page_links,
    read_sitemaps,
    sitemap_urls,
    strip_llms_note,
)

SITE = "https://docs.test"

PAGE = """<html><head><title>Tab title</title><link rel="canonical" href="/guide/start"></head>
<body>
  <header><a href="/">Home</a></header>
  <nav><a href="/guide/start">Start</a><a href="/guide/next">Next</a></nav>
  <main>
    <div class="sidebar"><a href="/guide/other">Other page</a></div>
    <h1>Getting started</h1>
    <p>Install the CLI, then <a href="install#linux">read this</a>.</p>
    <script>track()</script>
    <div id="on-this-page">On this page</div>
  </main>
  <footer><a href="mailto:help@docs.test">Mail</a><a href="#top">Top</a></footer>
</body></html>"""


def urlset(*urls: str) -> str:
    return "<urlset>" + "".join(f"<url><loc> {u} </loc></url>" for u in urls) + "</urlset>"


def sitemapindex(*urls: str) -> str:
    return "<sitemapindex>" + "".join(f"<sitemap><loc>{u}</loc></sitemap>" for u in urls) + "</sitemapindex>"


@pytest.fixture
def site(monkeypatch):
    """docs.test (and other.test) served by respx, through the component's real client choice: listed in
    CRAWL_ALLOWED_HOSTS, so the SSRF guard (which resolves DNS) is not consulted."""
    monkeypatch.setenv("CRAWL_ALLOWED_HOSTS", "docs.test, other.test")
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{SITE}/robots.txt").respond(404)
        yield router


def fetch(**inputs) -> dict:
    return WorkspaceWebPage(**inputs).fetch().data


# --- helpers ----------------------------------------------------------------------------------------


def test_sitemap_urls_tells_pages_from_nested_sitemaps():
    assert sitemap_urls(urlset("https://a/1", "https://a/2")) == (["https://a/1", "https://a/2"], [])
    assert sitemap_urls(sitemapindex("https://a/s1.xml")) == ([], ["https://a/s1.xml"])


def test_strip_llms_note_removes_only_the_leading_note():
    twin = "> ## Documentation Index\n> Fetch the complete index at: https://docs.test/llms.txt\n\n# Title\n\n> A quote"
    assert strip_llms_note(twin) == "# Title\n\n> A quote"
    assert strip_llms_note("# Title\n\n> quote about llms.txt\n") == "# Title\n\n> quote about llms.txt"


def test_page_links_are_absolute_without_mail_or_anchors_and_the_h1_wins_the_title():
    links, canonical, title = page_links(PAGE, f"{SITE}/guide/start")

    assert links == [f"{SITE}/", f"{SITE}/guide/start", f"{SITE}/guide/next", f"{SITE}/guide/other",
                     f"{SITE}/guide/install#linux"]
    assert canonical == f"{SITE}/guide/start"
    assert title == "Getting started"


def test_main_markdown_keeps_the_content_and_drops_the_sites_chrome():
    markdown = main_markdown(PAGE)

    assert markdown.startswith("# Getting started")
    assert "Install the CLI, then [read this](install#linux)." in markdown
    for chrome in ("Home", "Next", "Other page", "track()", "On this page", "Mail"):
        assert chrome not in markdown


def test_decode_falls_back_to_utf8_for_an_unknown_charset():
    assert decode("café".encode(), "no-such-charset") == "café"
    assert decode("café".encode("latin-1"), "latin-1") == "café"


def test_gunzip_stops_at_the_body_cap(monkeypatch):
    assert gunzip(gzip.compress(b"<urlset/>")) == b"<urlset/>"
    monkeypatch.setattr(web_page, "MAX_BODY_BYTES", 100)
    with pytest.raises(ValueError, match="larger than"):
        gunzip(gzip.compress(b"x" * 1000))


def test_the_ssrf_guard_refuses_private_addresses_and_langflows_own_hosts(monkeypatch):
    monkeypatch.delenv("CRAWL_ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv("LANGFLOW_SSRF_ALLOWED_HOSTS", "host.docker.internal")

    with pytest.raises(Blocked, match="SSRF guard"):
        _client_for("http://10.0.0.5/docs")
    with pytest.raises(Blocked, match="reserved for Langflow's own use"):
        _client_for("http://host.docker.internal:1234/v1")

    monkeypatch.setenv("CRAWL_ALLOWED_HOSTS", "10.0.0.5")
    with _client_for("http://10.0.0.5/docs") as client:
        assert client.headers["User-Agent"] == USER_AGENT


# --- page mode --------------------------------------------------------------------------------------


def test_page_mode_returns_markdown_links_and_title(site):
    route = site.get(f"{SITE}/guide/start").respond(200, html=PAGE)

    out = fetch(url=f" {SITE}/guide/start ")

    assert route.calls.last.request.headers["User-Agent"] == USER_AGENT
    assert out["status"] == 200 and out["finalUrl"] == f"{SITE}/guide/start"
    assert out["title"] == "Getting started"
    assert out["markdown"].startswith("# Getting started")
    assert f"{SITE}/guide/next" in out["links"]
    assert out["canonical"] == f"{SITE}/guide/start"
    assert (out["blocked"], out["skipped"], out["error"]) == (False, None, None)


def test_robots_txt_can_block_a_page(site):
    site.get(f"{SITE}/robots.txt").respond(200, text="User-agent: *\nDisallow: /private/\n")
    page = site.get(f"{SITE}/private/x").respond(200, html=PAGE)

    out = fetch(url=f"{SITE}/private/x")

    assert out["blocked"] is True and out["markdown"] == ""
    assert not page.called


def test_redirects_are_followed_hop_by_hop(site):
    site.get(f"{SITE}/old").respond(301, headers={"Location": "/guide/start"})
    site.get(f"{SITE}/guide/start").respond(200, html=PAGE)

    out = fetch(url=f"{SITE}/old")

    assert out["finalUrl"] == f"{SITE}/guide/start" and out["status"] == 200


def test_too_many_redirects_is_an_error_not_an_exception(site):
    site.get(f"{SITE}/loop").respond(302, headers={"Location": "/loop"})

    out = fetch(url=f"{SITE}/loop")

    assert "more than 10 redirects" in out["error"]


def test_the_markdown_twin_is_used_when_preferred(site):
    site.get(f"{SITE}/guide/start.md").respond(
        200, text="> See https://docs.test/llms.txt for the index\n\n# Start here\n\nBody.",
        headers={"Content-Type": "text/markdown; charset=utf-8"},
    )
    html = site.get(f"{SITE}/guide/start/").respond(200, html=PAGE)

    alone = fetch(url=f"{SITE}/guide/start/", prefer_markdown=True, want_links=False)
    assert (alone["markdown"], alone["title"], alone["links"]) == ("# Start here\n\nBody.", "Start here", [])
    assert not html.called

    with_links = fetch(url=f"{SITE}/guide/start/", prefer_markdown=True)
    assert with_links["markdown"] == "# Start here\n\nBody."  # the twin's text, the HTML's links
    assert f"{SITE}/guide/next" in with_links["links"]


def test_a_missing_twin_falls_back_to_the_html(site):
    site.get(f"{SITE}/guide/start.md").respond(404)
    site.get(f"{SITE}/guide/start").respond(200, html=PAGE)

    out = fetch(url=f"{SITE}/guide/start", prefer_markdown=True)

    assert out["markdown"].startswith("# Getting started")


def test_plain_text_pages_errors_and_other_types(site):
    site.get(f"{SITE}/notes.txt").respond(200, text="Plain notes.\n", headers={"Content-Type": "text/plain"})
    site.get(f"{SITE}/gone").respond(404, html="<h1>Not found</h1>")
    site.get(f"{SITE}/file.pdf").respond(200, content=b"%PDF", headers={"Content-Type": "application/pdf"})
    site.get(f"{SITE}/down").mock(side_effect=httpx.ConnectError("connection refused"))

    assert fetch(url=f"{SITE}/notes.txt")["markdown"] == "Plain notes."
    gone = fetch(url=f"{SITE}/gone")
    assert (gone["status"], gone["markdown"]) == (404, "")
    assert fetch(url=f"{SITE}/file.pdf")["skipped"] == "application/pdf"
    assert fetch(url=f"{SITE}/down")["error"] == "connection refused"


def test_a_body_over_the_cap_is_an_error(site, monkeypatch):
    monkeypatch.setattr(web_page, "MAX_BODY_BYTES", 1000)
    site.get(f"{SITE}/huge").respond(200, html="x" * 5000)

    assert "is larger than" in fetch(url=f"{SITE}/huge")["error"]


def test_a_blocked_host_is_reported_as_an_error(monkeypatch):
    monkeypatch.delenv("CRAWL_ALLOWED_HOSTS", raising=False)

    out = fetch(url="http://127.0.0.1/docs")

    assert "SSRF guard" in out["error"]


# --- sitemap mode -----------------------------------------------------------------------------------


def test_sitemap_mode_reads_the_scopes_own_sitemap_first(site):
    site.get(f"{SITE}/robots.txt").respond(200, text="User-agent: *\nCrawl-delay: 2\nSitemap: https://docs.test/all.xml\n")
    site.get(f"{SITE}/docs/sitemap.xml").respond(200, text=urlset(f"{SITE}/docs/a", f"{SITE}/docs/b"))
    everything = site.get(f"{SITE}/all.xml").respond(200, text=urlset(f"{SITE}/blog"))
    site.get(f"{SITE}/docs/llms.txt").respond(200, text="# Docs", headers={"Content-Type": "text/plain"})

    out = fetch(url=f"{SITE}/docs/", mode="sitemap")

    assert out == {"urls": [f"{SITE}/docs/a", f"{SITE}/docs/b"], "crawlDelay": 2.0, "hasLlmsTxt": True,
                   "complete": True}
    assert not everything.called


def test_sitemap_mode_falls_back_to_robots_and_the_root_sitemap(site):
    site.get(f"{SITE}/robots.txt").respond(200, text="Sitemap: https://docs.test/named.xml\n")
    site.get(f"{SITE}/docs/sitemap.xml").respond(404)
    site.get(f"{SITE}/named.xml").respond(200, text=urlset(f"{SITE}/docs/a"))
    site.get(f"{SITE}/sitemap.xml").respond(200, text=urlset(f"{SITE}/docs/a", f"{SITE}/docs/c"))
    site.get(f"{SITE}/docs/llms.txt").respond(404)

    out = fetch(url=f"{SITE}/docs/", mode="sitemap")

    assert out == {"urls": [f"{SITE}/docs/a", f"{SITE}/docs/c"], "crawlDelay": None, "hasLlmsTxt": False,
                   "complete": True}


def test_read_sitemaps_follows_indexes_on_the_same_origin_and_reads_gzip(site):
    site.get(f"{SITE}/index.xml").respond(200, text=sitemapindex(f"{SITE}/a.xml.gz", "https://other.test/b.xml"))
    site.get(f"{SITE}/a.xml.gz").respond(200, content=gzip.compress(urlset(f"{SITE}/p1").encode()))
    other = site.get("https://other.test/b.xml").respond(200, text=urlset("https://other.test/p2"))

    assert read_sitemaps([f"{SITE}/index.xml"], SITE) == ([f"{SITE}/p1"], True)
    assert not other.called


def test_read_sitemaps_is_incomplete_when_a_nested_sitemap_fails(site):
    site.get(f"{SITE}/index.xml").respond(200, text=sitemapindex(f"{SITE}/a.xml", f"{SITE}/b.xml"))
    site.get(f"{SITE}/a.xml").respond(200, text=urlset(f"{SITE}/p1"))
    site.get(f"{SITE}/b.xml").respond(500)

    assert read_sitemaps([f"{SITE}/index.xml"], SITE) == ([f"{SITE}/p1"], False)


def test_read_sitemaps_stops_at_the_file_cap(site, monkeypatch):
    monkeypatch.setattr(web_page, "MAX_SITEMAP_FILES", 2)
    site.get(f"{SITE}/index.xml").respond(200, text=sitemapindex(*(f"{SITE}/s{i}.xml" for i in range(3))))
    for i in range(3):
        site.get(f"{SITE}/s{i}.xml").respond(200, text=urlset(f"{SITE}/p{i}"))

    assert read_sitemaps([f"{SITE}/index.xml"], SITE) == ([f"{SITE}/p0"], False)


def test_no_sitemap_at_all_is_empty_and_incomplete(site):
    site.get(url__regex=r".*\.xml$").respond(404)

    assert read_sitemaps([f"{SITE}/sitemap.xml"], SITE) == ([], False)
