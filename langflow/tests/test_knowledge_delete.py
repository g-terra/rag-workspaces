import asyncio
import sys
import types
import uuid

import pytest

from rag_workspaces.knowledge_delete import KnowledgeDocumentDelete


class FakeBackend:
    def __init__(self, documents):
        self.documents = documents
        self.closed = False

    async def count(self):
        return len(self.documents)

    async def delete_by(self, where):
        self.documents = [d for d in self.documents if d != where["document_id"]]

    async def teardown(self):
        self.closed = True


@pytest.fixture
def backend(monkeypatch):
    """langflow itself is not a test dependency: stand in for the one function the component imports from it."""
    fake = FakeBackend(["doc-1", "doc-2", "doc-1"])
    fake.asked = []

    async def backend_for_name(owner, name):
        fake.asked.append((owner, name))
        return fake

    for name in ("langflow", "langflow.api", "langflow.api.utils", "langflow.api.utils.kb_helpers"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    sys.modules["langflow.api.utils.kb_helpers"].backend_for_name = backend_for_name
    return fake


def test_deletes_only_that_documents_chunks_from_the_owners_knowledge_base(backend):
    owner = uuid.uuid4()
    c = KnowledgeDocumentDelete(knowledge_base="ws_ouc", document_id="doc-1", _user_id=str(owner))

    assert asyncio.run(c.delete()).data == {"knowledge_base": "ws_ouc", "document_id": "doc-1", "deleted": 2}
    assert (backend.documents, backend.asked, backend.closed) == (["doc-2"], [(owner, "ws_ouc")], True)
