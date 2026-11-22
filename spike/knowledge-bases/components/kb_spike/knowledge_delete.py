"""Delete one document's chunks from a native Langflow knowledge base.

Langflow 1.13.3 has no route or component mode for this (spike finding F4), but every
knowledge-base backend implements ``delete_by``; ingestion uses it to roll back a failed
job. This component calls it for the flow owner's knowledge base, matching the
``document_id`` column that our ingest flow stores as chunk metadata.
"""

from lfx.custom.custom_component.component import Component
from lfx.io import Output, StrInput
from lfx.schema.data import Data


class KnowledgeDocumentDelete(Component):
    display_name = "Knowledge Document Delete"
    description = "Delete a document's chunks from a knowledge base by document id."
    icon = "trash-2"
    name = "KnowledgeDocumentDelete"

    inputs = [
        StrInput(name="knowledge_base", display_name="Knowledge", required=True),
        StrInput(name="document_id", display_name="Document ID", required=True),
    ]
    outputs = [Output(display_name="Result", name="result", method="delete")]

    async def delete(self) -> Data:
        import uuid

        from langflow.api.utils.kb_helpers import backend_for_name

        # Same ownership rule as the Knowledge component: the KB must belong to the flow's user.
        owner = self.user_id if isinstance(self.user_id, uuid.UUID) else uuid.UUID(str(self.user_id))
        backend = await backend_for_name(owner, self.knowledge_base)
        try:
            before = await backend.count()
            await backend.delete_by({"document_id": self.document_id})
            deleted = before - await backend.count()
        finally:
            await backend.teardown()
        result = {"knowledge_base": self.knowledge_base, "document_id": self.document_id, "deleted": deleted}
        self.status = result
        return Data(data=result)
