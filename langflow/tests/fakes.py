"""Stand-ins for the services the components call: embeddings, and the parts of Chroma's v2 REST API (via respx)."""

import json
import math
import re

import httpx
import respx
from langchain_core.embeddings import Embeddings

URL = "http://chroma.test"
BASE = f"{URL}/api/v2/tenants/default_tenant/databases/default_database"


class FakeEmbeddings(Embeddings):
    """Vectors chosen by the test: `vectors[text]`, or `default` for any other text. Records every call."""

    def __init__(self, vectors: dict[str, list[float]] | None = None, default: list[float] | None = None) -> None:
        self.vectors = vectors or {}
        self.default = default or [1.0, 0.0, 0.0]
        self.documents: list[list[str]] = []
        self.queries: list[str] = []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.documents.append(list(texts))
        return [self.vectors.get(t, self.default) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        self.queries.append(text)
        return self.vectors.get(text, self.default)


class FakeChroma:
    def __init__(self) -> None:
        self.collections: dict[str, dict] = {}  # name -> {"id", "configuration", "rows": {id: (doc, meta, emb)}}
        self.calls: list[tuple[str, str]] = []  # (method, path after BASE), in order

    def add(self, name: str, rows: dict[str, tuple[str, dict, list[float]]]) -> str:
        """Create a collection holding `rows` (id -> (text, metadata, vector)); returns its id."""
        cid = f"cid-{name}"
        self.collections[name] = {"id": cid, "configuration": {}, "rows": dict(rows)}
        return cid

    def rows(self, name: str) -> dict:
        return self.collections[name]["rows"]

    def _by_id(self, cid: str) -> dict:
        return next(c for c in self.collections.values() if c["id"] == cid)

    @staticmethod
    def _matches(meta: dict, where: dict | None) -> bool:
        return all(meta.get(k) == v for k, v in (where or {}).items())

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix(httpx.URL(BASE).path)
        self.calls.append((request.method, path))
        body = json.loads(request.content) if request.content else {}
        if request.method == "POST" and path == "/collections":
            c = self.collections.setdefault(body["name"], {"id": f"cid-{body['name']}", "rows": {}})
            c.setdefault("configuration", body.get("configuration"))
            return httpx.Response(200, json={"id": c["id"], "name": body["name"]})
        if m := re.fullmatch(r"/collections/([^/]+)", path):
            c = self.collections.get(m[1])
            return httpx.Response(200, json={"id": c["id"], "name": m[1]}) if c else httpx.Response(404, json={})
        m = re.fullmatch(r"/collections/([^/]+)/(\w+)", path)
        rows = self._by_id(m[1])["rows"]
        action = m[2]
        if action == "count":
            return httpx.Response(200, json=len(rows))
        if action == "upsert":
            for pid, doc, meta, emb in zip(body["ids"], body["documents"], body["metadatas"], body["embeddings"],
                                           strict=True):
                rows[pid] = (doc, meta, emb)
            return httpx.Response(200, json={})
        if action == "delete":
            for pid in [p for p, (_, meta, _) in rows.items() if self._matches(meta, body.get("where"))]:
                del rows[pid]
            return httpx.Response(200, json={})
        if action == "get":
            ids = [p for p in (body.get("ids") or rows) if p in rows and self._matches(rows[p][1], body.get("where"))]
            ids = ids[body.get("offset", 0):][: body.get("limit") or None]
            include = body.get("include", [])
            out = {"ids": ids}
            for key, n in (("documents", 0), ("metadatas", 1), ("embeddings", 2)):
                out[key] = [rows[p][n] for p in ids] if key in include else None
            return httpx.Response(200, json=out)
        if action == "query":
            ranked = []
            for q in body["query_embeddings"]:
                pool = [p for p, (_, meta, _) in rows.items() if self._matches(meta, body.get("where"))]
                pool.sort(key=lambda p: -cosine(q, rows[p][2]))
                ranked.append(pool[: body["n_results"]])
            return httpx.Response(200, json={"ids": ranked})
        return httpx.Response(500, json={"error": f"fake Chroma has no {request.method} {path}"})


def cosine(a: list[float], b: list[float]) -> float:
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b, strict=True)) / norm if norm else 0.0


def serve(fake: FakeChroma) -> respx.MockRouter:
    router = respx.mock(assert_all_called=False)
    router.route(url__startswith=URL).mock(side_effect=fake.handle)
    return router
