from fakes import URL

from rag_workspaces.chroma_delete import ChromaWorkspaceDelete


def delete(document_id: str) -> dict:
    return ChromaWorkspaceDelete(collection_name="ws_ouc", document_id=document_id, chroma_url=URL).delete().data


def test_deletes_only_that_documents_vectors_and_counts_them(chroma):
    chroma.add("ws_ouc", {
        "doc-1:0": ("a", {"document_id": "doc-1"}, [1.0]),
        "doc-1:1": ("b", {"document_id": "doc-1"}, [1.0]),
        "doc-2:0": ("c", {"document_id": "doc-2"}, [1.0]),
    })

    assert delete("doc-1") == {"collection": "ws_ouc", "document_id": "doc-1", "deleted": 2}
    assert list(chroma.rows("ws_ouc")) == ["doc-2:0"]


def test_a_document_with_no_vectors_deletes_nothing(chroma):
    chroma.add("ws_ouc", {"doc-2:0": ("c", {"document_id": "doc-2"}, [1.0])})

    assert delete("doc-1")["deleted"] == 0
    assert list(chroma.rows("ws_ouc")) == ["doc-2:0"]


def test_a_missing_collection_is_not_an_error(chroma):
    assert delete("doc-1") == {"document_id": "doc-1", "deleted": 0}
    assert chroma.calls == [("GET", "/collections/ws_ouc")]
