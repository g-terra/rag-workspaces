"""Search a workspace's Chroma collection and return structured passages.

Two outputs: `passages` (a JSON object with text, score, document_id, page,
start_seconds, filename, chunk_index per hit) and `context` (the same passages
formatted for a prompt, each tagged [n] so the model can cite them).
"""

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import FloatInput, HandleInput, IntInput, MessageTextInput, Output, StrInput
from lfx.schema.data import Data
from lfx.schema.message import Message


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
            body = {
                "query_embeddings": [self.embedding.embed_query(self.search_query)],
                "n_results": self.top_k,
                "include": ["documents", "metadatas", "distances"],
            }
            if self.folder:
                body["where"] = {"folder": self.folder}
            r = client.post(f"{self._base()}/collections/{cid}/query", json=body)
            r.raise_for_status()
            res = r.json()
        passages = []
        for rank, (pid, doc, meta, dist) in enumerate(
            zip(res["ids"][0], res["documents"][0], res["metadatas"][0], res["distances"][0], strict=True), start=1
        ):
            meta = meta or {}
            score = round(1.0 - float(dist), 4)  # cosine similarity
            if score < self.min_score:
                continue
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
