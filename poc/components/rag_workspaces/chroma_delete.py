"""Delete every vector of one document from a workspace's Chroma collection."""

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import Output, StrInput
from lfx.schema.data import Data


class ChromaWorkspaceDelete(Component):
    display_name = "Chroma Workspace Delete"
    description = "Delete a document's vectors from a Chroma collection by document id."
    icon = "trash-2"
    name = "ChromaWorkspaceDelete"

    inputs = [
        StrInput(name="collection_name", display_name="Collection Name", value="ws_default", required=True),
        StrInput(name="document_id", display_name="Document ID", required=True),
        StrInput(name="chroma_url", display_name="Chroma URL", value="http://chroma:8000", advanced=True),
        StrInput(name="tenant", display_name="Tenant", value="default_tenant", advanced=True),
        StrInput(name="database", display_name="Database", value="default_database", advanced=True),
    ]
    outputs = [Output(display_name="Result", name="result", method="delete")]

    def delete(self) -> Data:
        base = f"{self.chroma_url.rstrip('/')}/api/v2/tenants/{self.tenant}/databases/{self.database}"
        where = {"document_id": self.document_id}
        with httpx.Client(timeout=60) as client:
            r = client.get(f"{base}/collections/{self.collection_name}")
            if r.status_code == 404:
                return Data(data={"document_id": self.document_id, "deleted": 0})
            r.raise_for_status()
            cid = r.json()["id"]
            ids = client.post(f"{base}/collections/{cid}/get", json={"where": where, "include": []})
            ids.raise_for_status()
            n = len(ids.json()["ids"])
            client.post(f"{base}/collections/{cid}/delete", json={"where": where}).raise_for_status()
        result = {"collection": self.collection_name, "document_id": self.document_id, "deleted": n}
        self.status = result
        return Data(data=result)
