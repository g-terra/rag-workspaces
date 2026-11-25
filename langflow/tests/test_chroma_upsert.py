import pytest
from fakes import URL, FakeEmbeddings

from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame
from rag_workspaces.chroma_upsert import COLLECTION_HNSW, ChromaWorkspaceUpsert


def upsert(chunks, embedding=None, **inputs):
    component = ChromaWorkspaceUpsert(chunks=chunks, embedding=embedding or FakeEmbeddings(),
                                      collection_name="ws_ouc", document_id="doc-1", chroma_url=URL, **inputs)
    return component.upsert().data


def test_creates_the_collection_with_the_workspace_hnsw_settings(chroma):
    upsert([Data(data={"text": "one"})])

    assert chroma.calls[0] == ("POST", "/collections")
    assert chroma.collections["ws_ouc"]["configuration"] == {"hnsw": COLLECTION_HNSW}
    assert COLLECTION_HNSW == {"space": "cosine", "ef_construction": 200, "ef_search": 400, "max_neighbors": 32}


def test_writes_ids_text_vectors_and_scalar_metadata(chroma):
    chunks = DataFrame([
        Data(data={"text": "Page one.", "page": 1, "filename": "a.pdf", "folder": "w1", "tags": ["x"]}),
        Data(data={"text": "Page two.", "page": 2, "filename": "a.pdf", "folder": "w1", "tags": ["y"]}),
    ])
    embedding = FakeEmbeddings({"Page one.": [1.0, 0.0], "Page two.": [0.0, 1.0]})

    result = upsert(chunks, embedding)

    assert chroma.rows("ws_ouc") == {
        "doc-1:0": ("Page one.", {"page": 1, "filename": "a.pdf", "folder": "w1", "document_id": "doc-1",
                                  "chunk_index": 0}, [1.0, 0.0]),
        "doc-1:1": ("Page two.", {"page": 2, "filename": "a.pdf", "folder": "w1", "document_id": "doc-1",
                                  "chunk_index": 1}, [0.0, 1.0]),
    }
    assert result == {"collection": "ws_ouc", "document_id": "doc-1", "chunks": 2, "pages": 2}


def test_reingest_deletes_the_documents_old_vectors_first(chroma):
    chroma.add("ws_ouc", {
        "doc-1:0": ("old 0", {"document_id": "doc-1"}, [1.0, 0.0, 0.0]),
        "doc-1:1": ("old 1", {"document_id": "doc-1"}, [1.0, 0.0, 0.0]),
        "doc-1:2": ("old 2", {"document_id": "doc-1"}, [1.0, 0.0, 0.0]),
        "doc-2:0": ("other", {"document_id": "doc-2"}, [1.0, 0.0, 0.0]),
    })

    upsert([Data(data={"text": "new 0"})])

    assert {pid: row[0] for pid, row in chroma.rows("ws_ouc").items()} == {"doc-1:0": "new 0", "doc-2:0": "other"}
    actions = [path.rsplit("/", 1)[-1] for _, path in chroma.calls]
    assert actions.index("delete") < actions.index("upsert")


def test_embeds_and_writes_in_batches(chroma):
    embedding = FakeEmbeddings()

    upsert([{"text": f"chunk {i}"} for i in range(5)], embedding, batch_size=2)

    assert [len(batch) for batch in embedding.documents] == [2, 2, 1]
    assert [p for m, p in chroma.calls if p.endswith("/upsert")] == ["/collections/cid-ws_ouc/upsert"] * 3
    assert sorted(chroma.rows("ws_ouc")) == [f"doc-1:{i}" for i in range(5)]


def test_blank_chunks_are_dropped_and_numbering_stays_dense(chroma):
    result = upsert([{"text": "a"}, {"text": "  "}, {"text": "b"}])

    assert {pid: row[0] for pid, row in chroma.rows("ws_ouc").items()} == {"doc-1:0": "a", "doc-1:1": "b"}
    assert result["pages"] is None


def test_no_chunks_is_an_error_and_writes_nothing(chroma):
    with pytest.raises(ValueError, match="No chunks to write"):
        upsert([{"text": ""}])
    assert chroma.calls == []
