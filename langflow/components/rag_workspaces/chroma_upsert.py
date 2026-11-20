"""Embed chunks and write them to a workspace's Chroma collection over Chroma's REST API.

Langflow 1.13 retired its built-in Chroma component, so this talks to the
Chroma server directly (httpx only, no chromadb package needed). Before writing
it deletes the document's existing vectors, so re-ingesting is idempotent.
"""

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import HandleInput, IntInput, Output, StrInput
from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame


class ChromaWorkspaceUpsert(Component):
    display_name = "Chroma Workspace Upsert"
    description = "Embed chunks and upsert them into a Chroma collection, replacing the document's old vectors."
    icon = "database"
    name = "ChromaWorkspaceUpsert"

    inputs = [
        HandleInput(name="chunks", display_name="Chunks", input_types=["Table", "DataFrame", "Data", "JSON"], required=True),
        HandleInput(name="embedding", display_name="Embedding", input_types=["Embeddings"], required=True),
        StrInput(name="collection_name", display_name="Collection Name", value="ws_default", required=True),
        StrInput(name="document_id", display_name="Document ID", required=True),
        StrInput(name="chroma_url", display_name="Chroma URL", value="http://chroma:8000", advanced=True),
        StrInput(name="tenant", display_name="Tenant", value="default_tenant", advanced=True),
        StrInput(name="database", display_name="Database", value="default_database", advanced=True),
        IntInput(name="batch_size", display_name="Batch Size", value=64, advanced=True),
    ]
    outputs = [Output(display_name="Result", name="result", method="upsert")]

    def _base(self) -> str:
        return f"{self.chroma_url.rstrip('/')}/api/v2/tenants/{self.tenant}/databases/{self.database}"

    def _collection_id(self, client: httpx.Client) -> str:
        r = client.post(f"{self._base()}/collections", json={
            "name": self.collection_name,
            "get_or_create": True,
            "configuration": {"hnsw": {"space": "cosine"}},
        })
        r.raise_for_status()
        return r.json()["id"]

    def _rows(self) -> list[dict]:
        chunks = self.chunks
        if isinstance(chunks, DataFrame):
            return chunks.to_dict(orient="records")
        if isinstance(chunks, Data):
            return [chunks.data]
        return [c.data if isinstance(c, Data) else dict(c) for c in chunks]

    def upsert(self) -> Data:
        rows = [r for r in self._rows() if str(r.get("text", "")).strip()]
        if not rows:
            msg = "No chunks to write"
            raise ValueError(msg)
        texts = [str(r["text"]) for r in rows]
        metadatas = []
        for i, r in enumerate(rows):
            m = {k: v for k, v in r.items() if k != "text" and isinstance(v, (str, int, float, bool))}
            m.update({"document_id": self.document_id, "chunk_index": i})
            metadatas.append(m)
        ids = [f"{self.document_id}:{i}" for i in range(len(rows))]

        with httpx.Client(timeout=120) as client:
            cid = self._collection_id(client)
            client.post(f"{self._base()}/collections/{cid}/delete",
                        json={"where": {"document_id": self.document_id}}).raise_for_status()
            for start in range(0, len(rows), self.batch_size):
                end = start + self.batch_size
                vectors = self.embedding.embed_documents(texts[start:end])
                client.post(f"{self._base()}/collections/{cid}/upsert", json={
                    "ids": ids[start:end],
                    "embeddings": vectors,
                    "documents": texts[start:end],
                    "metadatas": metadatas[start:end],
                }).raise_for_status()

        pages = sorted({m["page"] for m in metadatas if "page" in m})
        result = {"collection": self.collection_name, "document_id": self.document_id,
                  "chunks": len(rows), "pages": len(pages) or None}
        self.status = result
        return Data(data=result)
