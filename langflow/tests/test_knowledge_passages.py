import json

from lfx.schema.dataframe import DataFrame

from rag_workspaces.knowledge_passages import KnowledgePassages


def row(text="a", score=-0.2, **meta):
    return {"content": text, "_score": score, "document_id": "doc-1", "filename": "a.pdf",
            "chunk_index": "0", "source_metadata": json.dumps({"document_id": "doc-1"}), **meta}


def passages(rows, **inputs):
    return KnowledgePassages(rows=DataFrame(rows), **inputs)


def test_shapes_a_row_with_similarity_and_numeric_page_and_index():
    p = passages([row(page="3", chunk_index="7")]).get_passages().data["passages"]

    assert p == [{"rank": 1, "id": "doc-1:7", "text": "a", "score": 0.8, "document_id": "doc-1",
                  "filename": "a.pdf", "page": 3, "start_seconds": None, "chunk_index": 7}]


def test_drops_rows_below_min_score_and_ranks_the_rest():
    c = passages([row("far", -0.9), row("edge", -0.7), row("near", -0.1)], min_score=0.3)

    assert [(p["rank"], p["text"]) for p in c.get_passages().data["passages"]] == [(1, "edge"), (2, "near")]


def test_no_rows_give_no_passages():
    c = KnowledgePassages(rows=DataFrame([]))

    assert c.get_passages().data["passages"] == []
    assert c.get_context().text == "No relevant passages found."


def test_a_missing_value_from_a_mixed_table_is_none():
    p = passages([row(page="1"), row("b", start_seconds="75.0")]).get_passages().data["passages"]

    assert (p[1]["page"], p[1]["start_seconds"]) == (None, 75)
    assert p[0]["start_seconds"] is None


def test_context_tags_each_passage_with_where_it_comes_from():
    c = passages([row("one", page="2"), row("two", start_seconds="75")])

    assert c.get_context().text == "[1] (a.pdf, page 2)\none\n\n[2] (a.pdf, at 1:15)\ntwo"
