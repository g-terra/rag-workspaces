"""Search a workspace's Chroma collection and return structured passages.

Hybrid search: the question is matched by meaning (cosine similarity to the passages' vectors) and by its words
(BM25 over the passages' text and file names), and the two rankings are fused with reciprocal rank fusion. Words alone find
rare exact terms (a name, a code, a symbol) that similarity ranks low; meaning alone finds paraphrases.
`score` stays the cosine similarity, so `min_score` means what it always did.

Matching by meaning is exact: the passages' vectors are cached with the keyword index and every one is scored
(about 2 ms for 18,000 passages). Chroma's HNSW index is approximate and, on real material, left passages that
rank in the exact top 5 out of its top 200 entirely. Only a collection too big to hold in memory
(`EXACT_MAX_VALUES`) falls back to Chroma's own vector search.

A question with several parts ("What is X, and how does Y work?") is searched part by part instead: each
part gets its own fused ranking, and the parts take turns filling the results (`question_parts`,
`interleave`), so a part with few words still gets its share of passages.

Two outputs: `passages` (a JSON object with text, score, document_id, page,
start_seconds, filename, chunk_index per hit) and `context` (the same passages
formatted for a prompt, each tagged [n] so the model can cite them).
"""

import math
import re
import sys
import threading
import time
import types
from collections import Counter

import httpx
import numpy as np

from lfx.custom.custom_component.component import Component
from lfx.io import FloatInput, HandleInput, IntInput, MessageTextInput, Output, StrInput
from lfx.schema.data import Data
from lfx.schema.message import Message


# How many candidates each ranking contributes before fusion, and RRF's k (the usual 60).
CANDIDATES = 200
RRF_K = 60
# BM25 (Okapi) parameters.
BM25_K1 = 1.5
BM25_B = 0.75
# A collection's keyword index is rebuilt when its passage count changes, or after this many seconds.
INDEX_TTL_SECONDS = 120
PAGE = 1000
# Vectors are kept in memory (float32) for exact search up to this many numbers per collection: 64M is 256 MB,
# for example 80,000 passages of 768 dimensions. Bigger collections use Chroma's approximate (HNSW) search.
EXACT_MAX_VALUES = 64_000_000

_WORD = re.compile(r"\w+", re.UNICODE)


def words(text: str) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if len(w) > 1]


class KeywordIndex:
    """BM25 over a collection's passages: postings per word, document lengths and metadata for filtering."""

    def __init__(self, ids: list[str], texts: list[str], metadatas: list[dict]) -> None:
        self.ids = ids
        self.metadatas = metadatas
        self.lengths = []
        self.postings: dict[str, list[tuple[int, int]]] = {}
        for i, (text, meta) in enumerate(zip(texts, metadatas, strict=True)):
            counts = Counter(words(f"{(meta or {}).get('filename') or ''} {text}"))
            self.lengths.append(sum(counts.values()))
            for word, tf in counts.items():
                self.postings.setdefault(word, []).append((i, tf))
        self.average = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0

    def search(self, query: str, limit: int, folder: str | None = None) -> list[str]:
        n = len(self.ids)
        scores: dict[int, float] = {}
        for word in set(words(query)):
            posting = self.postings.get(word)
            if not posting:
                continue
            idf = math.log(1 + (n - len(posting) + 0.5) / (len(posting) + 0.5))
            for i, tf in posting:
                norm = BM25_K1 * (1 - BM25_B + BM25_B * self.lengths[i] / (self.average or 1))
                scores[i] = scores.get(i, 0.0) + idf * tf * (BM25_K1 + 1) / (tf + norm)
        if folder:
            scores = {i: v for i, v in scores.items() if (self.metadatas[i] or {}).get("folder") == folder}
        best = sorted(scores, key=lambda i: scores[i], reverse=True)[:limit]
        return [self.ids[i] for i in best]


# Words that start a new question after "and": "…, and how does …", "… and what is …".
_STARTS = (
    "what|how|why|when|where|which|who|whom|whose|is|are|was|were|does|do|did|can|could|should|would|will|"
    "explain|describe|list|name|give|define|compare|outline|state"
)
_AND_NEW_QUESTION = re.compile(rf"\s*,?\s*\band\s+(?=(?:{_STARTS})\b)", re.IGNORECASE)
_QUESTION = re.compile(r"[^?]*\?")
MAX_PARTS = 4


def question_parts(query: str) -> list[str]:
    """The separate questions in the last line of a query, or [] when it asks one thing.

    Only the last line: a chat search puts the previous question on the line before it, as context.
    Splits on question marks ("What is X? How does Y work?") and on "and" before a question word or an
    instruction ("What is X and how does Y work", "Define X and explain Y"); each part needs two words.
    """
    line = (query or "").strip().splitlines()[-1].strip() if (query or "").strip() else ""
    asked = [q.strip() for q in _QUESTION.findall(line)]
    rest = line[sum(len(q) for q in _QUESTION.findall(line)):].strip() if asked else line
    pieces = (asked + ([rest] if rest else [])) if len(asked) > 1 or (asked and rest) else [line]
    parts = []
    for piece in pieces:
        parts += [p.strip(" ,;") for p in _AND_NEW_QUESTION.split(piece)]
    parts = [p for p in parts if len(words(p)) >= 2]
    return parts[:MAX_PARTS] if len(parts) > 1 else []


def fuse(*rankings: list[str], k: int = RRF_K) -> list[str]:
    """Reciprocal rank fusion: each list gives 1 / (k + rank) to its ids; best total first, ties by first seen."""
    totals: dict[str, float] = {}
    for ranking in rankings:
        for rank, pid in enumerate(ranking, start=1):
            totals[pid] = totals.get(pid, 0.0) + 1.0 / (k + rank)
    return sorted(totals, key=lambda pid: totals[pid], reverse=True)


def interleave(rankings: list[list[str]]) -> list[str]:
    """Take turns: the first of each ranking, then the second of each, …, skipping ids already taken."""
    out: list[str] = []
    seen: set[str] = set()
    for row in range(max((len(r) for r in rankings), default=0)):
        for ranking in rankings:
            if row < len(ranking) and ranking[row] not in seen:
                seen.add(ranking[row])
                out.append(ranking[row])
    return out


class VectorIndex:
    """A collection's vectors, normalised, for exact cosine search."""

    def __init__(self, ids: list[str], vectors: list, metadatas: list[dict]) -> None:
        self.ids = ids
        matrix = np.stack(vectors).astype(np.float32, copy=False) if len(vectors) else np.zeros((0, 0), np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        self.matrix = matrix / np.where(norms == 0, 1, norms)
        self.folders = np.asarray([(m or {}).get("folder") or "" for m in metadatas], dtype=object)

    def search(self, query: list[float], limit: int, folder: str | None = None) -> list[str]:
        q = np.asarray(query, dtype=np.float32)
        q = q / (np.linalg.norm(q) or 1)
        scores = self.matrix @ q
        candidates = np.flatnonzero(self.folders == folder) if folder else np.arange(len(self.ids))
        if len(candidates) > limit:
            top = np.argpartition(-scores[candidates], limit - 1)[:limit]
            candidates = candidates[top]
        best = candidates[np.argsort(-scores[candidates], kind="stable")]
        return [self.ids[i] for i in best]


# Indexes by (Chroma URL, collection id), kept across runs in this Langflow worker: the passage count when built,
# when it was built, the keyword index, and the vector index (None when the collection is too big for it).
# Langflow builds this component from its source on every run, in a fresh namespace, so a plain module-level
# dict would start empty each time. The cache lives in a module registered in sys.modules instead, which every
# run of the component in this worker shares. The lock keeps two searches (retrieve, then answer) from
# building the same index at once.
_SHARED = sys.modules.setdefault("rag_workspaces_search_cache", types.ModuleType("rag_workspaces_search_cache"))
_INDEXES: dict[tuple[str, str], tuple[int, float, KeywordIndex, VectorIndex | None]] = _SHARED.__dict__.setdefault(
    "indexes", {}
)
_LOCK: threading.Lock = _SHARED.__dict__.setdefault("lock", threading.Lock())


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class ChromaWorkspaceSearch(Component):
    display_name = "Chroma Workspace Search"
    description = "Similarity search in a workspace collection, returning passages with score, document id and page."
    icon = "search"
    name = "ChromaWorkspaceSearch"

    inputs = [
        MessageTextInput(name="search_query", display_name="Search Query", required=True),
        HandleInput(name="embedding", display_name="Embedding", input_types=["Embeddings"], required=True),
        StrInput(name="collection_name", display_name="Collection Name", value="ws_default", required=True),
        IntInput(name="top_k", display_name="Top K", value=4),
        MessageTextInput(name="folder", display_name="Folder Filter", info="Only search this folder, if set."),
        FloatInput(name="min_score", display_name="Min Score", value=0.0, advanced=True),
        StrInput(name="chroma_url", display_name="Chroma URL", value="http://chroma:8000", advanced=True),
        StrInput(name="tenant", display_name="Tenant", value="default_tenant", advanced=True),
        StrInput(name="database", display_name="Database", value="default_database", advanced=True),
    ]
    # group_outputs=True gives each output its own handle. Without it the editor shows one
    # dropdown handle, pins it to the first output on load and drops every edge wired from the
    # other one ("Some connections were removed because they were invalid"). Both outputs are
    # used at once: context feeds the prompt, passages feed the citations output.
    outputs = [
        Output(display_name="Passages", name="passages", method="get_passages", group_outputs=True),
        Output(display_name="Context", name="context", method="get_context", group_outputs=True),
    ]

    def _base(self) -> str:
        return f"{self.chroma_url.rstrip('/')}/api/v2/tenants/{self.tenant}/databases/{self.database}"

    def _indexes(self, client: httpx.Client, cid: str) -> tuple[KeywordIndex, VectorIndex | None]:
        """The collection's BM25 and vector indexes, rebuilt when its passage count changed or they are a few
        minutes old. The vector index is None when the collection has more than EXACT_MAX_VALUES numbers.

        A rebuild reads every passage's text again (about 0.4 s for 18,000) but only the vectors of passages it
        has not seen: reading all vectors takes several seconds. A passage id is its document and chunk number,
        and a document's chunks are not rewritten in place, so a vector already held is still right.
        """
        r = client.get(f"{self._base()}/collections/{cid}/count")
        r.raise_for_status()
        count = int(r.json())
        with _LOCK:
            return self._fresh_indexes(client, cid, count)

    def _fresh_indexes(self, client: httpx.Client, cid: str, count: int) -> tuple[KeywordIndex, VectorIndex | None]:
        key = (self._base(), cid)
        cached = _INDEXES.get(key)
        if cached and cached[0] == count and time.monotonic() - cached[1] < INDEX_TTL_SECONDS:
            return cached[2], cached[3]
        ids, texts, metadatas = [], [], []
        for offset in range(0, count, PAGE):
            r = client.post(f"{self._base()}/collections/{cid}/get",
                            json={"limit": PAGE, "offset": offset, "include": ["documents", "metadatas"]})
            r.raise_for_status()
            page = r.json()
            ids += page["ids"]
            texts += [d or "" for d in page["documents"]]
            metadatas += [m or {} for m in page["metadatas"]]
        keyword = KeywordIndex(ids, texts, metadatas)
        vector = self._vector_index(client, cid, ids, metadatas, cached[3] if cached else None)
        _INDEXES[key] = (count, time.monotonic(), keyword, vector)
        return keyword, vector

    def _vector_index(
        self, client: httpx.Client, cid: str, ids: list[str], metadatas: list[dict], previous: VectorIndex | None
    ) -> VectorIndex | None:
        """Vectors for `ids`, reusing the previous index's rows and reading only the new ones from Chroma."""
        known = {pid: row for row, pid in enumerate(previous.ids)} if previous is not None else {}
        missing = [pid for pid in ids if pid not in known]
        fetched: dict[str, np.ndarray] = {}
        dimensions = previous.matrix.shape[1] if previous is not None else None
        for start in range(0, len(missing), PAGE):
            batch = missing[start : start + PAGE]
            r = client.post(f"{self._base()}/collections/{cid}/get", json={"ids": batch, "include": ["embeddings"]})
            r.raise_for_status()
            page = r.json()
            # float32 at once: as Python floats, Chroma's JSON numbers take about eight times the memory.
            vectors = np.asarray(page["embeddings"], dtype=np.float32)
            fetched.update(zip(page["ids"], vectors, strict=True))
            dimensions = dimensions or (vectors.shape[1] if len(vectors) else None)
            if dimensions and len(ids) * dimensions > EXACT_MAX_VALUES:
                return None
        if not ids or not dimensions:
            return None
        # A passage deleted between the two reads has no vector: leave it out.
        present = [i for i, pid in enumerate(ids) if pid in fetched or pid in known]
        rows = [fetched[ids[i]] if ids[i] in fetched else previous.matrix[known[ids[i]]] for i in present]
        return VectorIndex([ids[i] for i in present], rows, [metadatas[i] for i in present])

    def _vector_ranking(
        self, client: httpx.Client, cid: str, embeddings: list[list[float]], limit: int, folder: str | None
    ) -> list[list[str]]:
        """The best `limit` passage ids by cosine for each query vector: exact from the cached vectors, or
        Chroma's approximate search when the collection is too big to cache."""
        _, vector = self._indexes(client, cid)
        if vector is not None:
            return [vector.search(e, limit, folder) for e in embeddings]
        body = {"query_embeddings": embeddings, "n_results": limit, "include": ["distances"]}
        if folder:
            body["where"] = {"folder": folder}
        r = client.post(f"{self._base()}/collections/{cid}/query", json=body)
        r.raise_for_status()
        return r.json()["ids"]

    def _search(self) -> list[dict]:
        if hasattr(self, "_cached"):
            return self._cached
        with httpx.Client(timeout=60) as client:
            r = client.get(f"{self._base()}/collections/{self.collection_name}")
            if r.status_code == 404:
                self._cached = []
                return self._cached
            r.raise_for_status()
            cid = r.json()["id"]
            # Each part of a multi-part question on its own, by meaning and by words. Not the whole question
            # as well: it leans to whichever part has more words, which is what splitting corrects. Fusing all
            # parts' rankings together would favour passages that are middling for every part, so each part
            # is fused on its own and the parts take turns.
            queries = question_parts(self.search_query) or [self.search_query]
            embeddings = [self.embedding.embed_query(q) for q in queries]
            # Scores are always against the whole query, so they mean the same with or without parts.
            query_embedding = embeddings[0] if len(queries) == 1 else self.embedding.embed_query(self.search_query)
            by_meaning = self._vector_ranking(
                client, cid, embeddings, max(CANDIDATES, self.top_k), self.folder or None
            )
            index, _ = self._indexes(client, cid)
            per_query = [
                fuse(meaning, index.search(q, max(CANDIDATES, self.top_k), self.folder or None))
                for q, meaning in zip(queries, by_meaning, strict=True)
            ]
            best = interleave(per_query)[: self.top_k]
            if not best:
                self._cached = []
                return self._cached
            # Read the winners fresh (the keyword index may be a little old) with their vectors, so every
            # hit gets its cosine score, also one only the keyword ranking found.
            r = client.post(f"{self._base()}/collections/{cid}/get",
                            json={"ids": best, "include": ["documents", "metadatas", "embeddings"]})
            r.raise_for_status()
            got = r.json()
        rows = {
            pid: (doc, meta, emb)
            for pid, doc, meta, emb in zip(got["ids"], got["documents"], got["metadatas"], got["embeddings"], strict=True)
        }
        passages = []
        for pid in best:
            if pid not in rows:  # deleted since the keyword index was built
                continue
            doc, meta, emb = rows[pid]
            meta = meta or {}
            score = round(cosine(query_embedding, emb), 4)
            if score < self.min_score:
                continue
            rank = len(passages) + 1
            passages.append({
                "rank": rank,
                "id": pid,
                "text": doc,
                "score": score,
                "document_id": meta.get("document_id"),
                "filename": meta.get("filename"),
                "folder": meta.get("folder"),
                "page": meta.get("page"),
                "start_seconds": meta.get("start_seconds"),
                "chunk_index": meta.get("chunk_index"),
            })
        self._cached = passages
        return passages

    def get_passages(self) -> Data:
        passages = self._search()
        self.status = f"{len(passages)} passage(s)"
        return Data(data={"collection": self.collection_name, "query": self.search_query, "passages": passages})

    def get_context(self) -> Message:
        passages = self._search()
        blocks = []
        for p in passages:
            where = p["filename"] or p["document_id"]
            if p.get("page"):
                where += f", page {p['page']}"
            elif p.get("start_seconds") is not None:
                where += f", at {clock(p['start_seconds'])}"
            blocks.append(f"[{p['rank']}] ({where})\n{p['text']}")
        return Message(text="\n\n".join(blocks) if blocks else "No relevant passages found.")


def clock(seconds: float) -> str:
    """12:34, or 1:02:03 past an hour: how a person reads a time in a recording."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
