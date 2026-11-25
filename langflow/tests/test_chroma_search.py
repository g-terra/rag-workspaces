import numpy as np
import pytest
from fakes import URL, FakeChroma, FakeEmbeddings, serve

from rag_workspaces import chroma_search
from rag_workspaces.chroma_search import (
    ChromaWorkspaceSearch,
    KeywordIndex,
    VectorIndex,
    clock,
    fuse,
    interleave,
    question_parts,
    words,
)

# --- the ranking helpers ---------------------------------------------------------------------------


def test_words_are_lowercase_and_skip_single_characters():
    assert words("The XJ-9 model, v2!") == ["the", "xj", "model", "v2"]
    assert words(None) == []


def test_fuse_adds_reciprocal_ranks_across_rankings():
    # a: 1/61 + 1/62, c: 1/63 + 1/61, b: 1/62
    assert fuse(["a", "b", "c"], ["c", "a"]) == ["a", "c", "b"]
    assert fuse(["a", "b"], ["b", "a"], k=0) == ["a", "b"]  # a tie keeps the order first seen


def test_fuse_rewards_agreement_over_one_high_rank():
    # x is 2nd in both lists; y is 1st in one list only.
    assert fuse(["y", "x"], ["z", "x"])[0] == "x"


def test_interleave_takes_turns_and_skips_ids_already_taken():
    assert interleave([["a", "b", "c"], ["b", "d"]]) == ["a", "b", "c", "d"]
    assert interleave([[], ["x"]]) == ["x"]
    assert interleave([]) == []


@pytest.mark.parametrize(("query", "parts"), [
    ("What is RAG?", []),
    ("What is RAG", []),
    ("salt and pepper", []),
    ("What is RAG? How does BM25 work?", ["What is RAG?", "How does BM25 work?"]),
    ("What is RAG and how does BM25 work", ["What is RAG", "how does BM25 work"]),
    ("Define chunking, and explain overlap", ["Define chunking", "explain overlap"]),
    ("What is RAG? And?", []),  # a part needs two words
    ("Earlier question?\nWhat is X? What is Y?", ["What is X?", "What is Y?"]),  # only the last line
    ("What is a? What is b? What is c? What is d? What is e?",
     ["What is a?", "What is b?", "What is c?", "What is d?"]),
])
def test_question_parts(query, parts):
    assert question_parts(query) == parts


def test_keyword_index_ranks_rare_words_and_reads_file_names():
    index = KeywordIndex(
        ["p1", "p2", "p3"],
        ["the model answers questions", "the model uses retrieval", "the XJ-9 board"],
        [{"filename": "intro.pdf"}, {"filename": "rag-guide.pdf", "folder": "w2"}, {}],
    )

    assert index.search("XJ-9 model", 3) == ["p3", "p1", "p2"]  # "xj" is rare, "model" common
    assert index.search("rag guide", 3) == ["p2"]  # matched by its file name
    assert index.search("model", 3, folder="w2") == ["p2"]
    assert index.search("nothing matches", 3) == []
    assert KeywordIndex([], [], []).search("anything", 3) == []


def test_vector_index_is_exact_cosine_with_folder_and_limit():
    index = VectorIndex(
        ["a", "b", "c", "z"],
        [np.array([1.0, 0.0]), np.array([0.6, 0.8]), np.array([0.0, 2.0]), np.array([0.0, 0.0])],
        [{"folder": "w1"}, {"folder": "w2"}, {"folder": "w2"}, {}],
    )

    assert index.search([1.0, 0.1], 4) == ["a", "b", "c", "z"]
    assert index.search([1.0, 0.1], 2) == ["a", "b"]
    assert index.search([0.0, 1.0], 4, folder="w2") == ["c", "b"]


def test_clock_reads_like_a_recording_time():
    assert clock(5) == "0:05"
    assert clock(75.9) == "1:15"
    assert clock(3723) == "1:02:03"


# --- the component against a fake Chroma ----------------------------------------------------------

QUERY = "What is the XJ-9?"


def passages(**extra):
    """Five passages close to the query by meaning, and one far from it that holds its rare word."""
    rows = {f"doc-a:{i}": (f"General notes about models, part {i}.",
                           {"document_id": "doc-a", "filename": "notes.pdf", "page": i + 1, "chunk_index": i,
                            "folder": "w1"},
                           [1.0, 0.05 * i, 0.0]) for i in range(5)}
    rows["doc-b:0"] = ("XJ-9 board reference.", {"document_id": "doc-b", "filename": "talk.mp4",
                                                  "start_seconds": 75.0, "chunk_index": 0, "folder": "w2"},
                       [0.0, 0.0, 1.0])
    rows.update(extra)
    return rows


def search(**inputs) -> ChromaWorkspaceSearch:
    defaults = {"search_query": QUERY, "embedding": FakeEmbeddings(default=[1.0, 0.0, 0.0]),
                "collection_name": "ws_ouc", "top_k": 2, "chroma_url": URL}
    return ChromaWorkspaceSearch(**{**defaults, **inputs})


def found(component: ChromaWorkspaceSearch) -> list[str]:
    return [p["id"] for p in component.get_passages().data["passages"]]


def test_a_rare_word_finds_a_passage_meaning_alone_ranks_last(chroma):
    chroma.add("ws_ouc", passages())

    result = search().get_passages().data

    ids = [p["id"] for p in result["passages"]]
    assert ids == ["doc-b:0", "doc-a:0"]  # BM25 first + cosine last beats cosine first alone
    rare = result["passages"][0]
    assert rare == {"rank": 1, "id": "doc-b:0", "text": "XJ-9 board reference.", "score": 0.0,
                    "document_id": "doc-b", "filename": "talk.mp4", "folder": "w2", "page": None,
                    "start_seconds": 75.0, "chunk_index": 0}
    assert result["passages"][1]["score"] == 1.0
    assert result["query"] == QUERY and result["collection"] == "ws_ouc"


def test_min_score_drops_low_cosine_passages_and_ranks_the_rest_again(chroma):
    chroma.add("ws_ouc", passages())

    result = search(min_score=0.5).get_passages().data["passages"]

    assert [(p["rank"], p["id"]) for p in result] == [(1, "doc-a:0")]


def test_the_folder_filter_keeps_other_folders_out_of_both_rankings(chroma):
    chroma.add("ws_ouc", passages())

    assert found(search(folder="w1", top_k=10)) == [f"doc-a:{i}" for i in range(5)]
    assert found(search(folder="w2", top_k=10)) == ["doc-b:0"]


def test_top_k_limits_the_passages(chroma):
    chroma.add("ws_ouc", passages())

    assert len(found(search(top_k=4))) == 4
    assert len(found(search(top_k=50))) == 6


def test_a_missing_or_empty_collection_finds_nothing(chroma):
    assert found(search()) == []
    assert search().get_context().text == "No relevant passages found."
    chroma.add("ws_ouc", {})
    assert found(search()) == []


def test_context_tags_each_passage_with_where_it_comes_from(chroma):
    chroma.add("ws_ouc", passages())

    context = search().get_context().text

    assert context == "[1] (talk.mp4, at 1:15)\nXJ-9 board reference.\n\n[2] (notes.pdf, page 1)\nGeneral notes about models, part 0."


def test_each_part_of_a_question_gets_its_turn(chroma):
    query = "What is alpha? How does beta work?"
    alpha = [1.0, 0.0, 0.0]
    beta = [0.0, 1.0, 0.0]
    chroma.add("ws_ouc", {
        **{f"a:{i}": (f"Alpha alpha topic {i}.", {"document_id": "a"}, [1.0, 0.01 * i, 0.0]) for i in range(4)},
        "b:0": ("Beta works like this.", {"document_id": "b"}, [0.0, 1.0, 0.0]),
    })
    # The whole question leans to alpha by meaning.
    embedding = FakeEmbeddings({"What is alpha?": alpha, "How does beta work?": beta, query: [1.0, 0.2, 0.0]})

    result = search(search_query=query, embedding=embedding).get_passages().data["passages"]

    assert embedding.queries == ["What is alpha?", "How does beta work?", query]
    assert sorted(p["id"] for p in result) == ["a:0", "b:0"]
    # Scores are against the whole question, not a part: b:0 is 0.196 from it, 1.0 from its own part.
    assert {p["id"]: p["score"] for p in result}["b:0"] == 0.1961


def test_the_index_is_cached_and_reads_only_new_vectors_when_the_collection_grows(chroma):
    chroma.add("ws_ouc", passages())
    search().get_passages()

    def vector_reads() -> list[list[str]]:
        return [b["ids"] for b in chroma.bodies if b.get("include") == ["embeddings"]]

    first = vector_reads()
    assert sorted(first[0]) == sorted(passages())

    search().get_passages()  # same count: no index rebuild
    assert vector_reads() == first

    chroma.rows("ws_ouc")["doc-c:0"] = ("New XJ-9 errata.", {"document_id": "doc-c"}, [0.0, 0.0, 1.0])
    search().get_passages()
    assert vector_reads()[1:] == [["doc-c:0"]]


def test_get_passages_and_get_context_share_one_search(chroma):
    chroma.add("ws_ouc", passages())
    component = search()

    component.get_passages()
    calls = len(chroma.calls)
    component.get_context()

    assert len(chroma.calls) == calls


def test_a_collection_too_big_for_memory_uses_chromas_own_vector_search(chroma, monkeypatch):
    monkeypatch.setattr(chroma_search, "EXACT_MAX_VALUES", 3)
    chroma.add("ws_ouc", passages())

    assert found(search()) == ["doc-b:0", "doc-a:0"]
    assert found(search(folder="w1", top_k=10)) == [f"doc-a:{i}" for i in range(5)]
    queries = [b for (_, path), b in zip(chroma.calls, chroma.bodies, strict=True) if path.endswith("/query")]
    assert queries[-1]["where"] == {"folder": "w1"}


def test_the_index_is_rebuilt_once_it_is_a_few_minutes_old(chroma, monkeypatch):
    chroma.add("ws_ouc", passages())
    now = [1000.0]
    monkeypatch.setattr(chroma_search.time, "monotonic", lambda: now[0])

    def keyword_reads() -> int:
        return sum(1 for b in chroma.bodies if b.get("include") == ["documents", "metadatas"])

    search().get_passages()
    search().get_passages()
    assert keyword_reads() == 1

    now[0] += chroma_search.INDEX_TTL_SECONDS + 1
    search().get_passages()
    assert keyword_reads() == 2


def test_two_chroma_servers_never_share_an_index(chroma):
    chroma.add("ws_ouc", passages())
    other = FakeChroma()
    # The same collection id and passage count, different passages.
    other.add("ws_ouc", {f"x:{i}": (f"Other server XJ-9 note {i}.", {"document_id": "x"}, [1.0, 0.0, 0.0])
                         for i in range(6)})

    assert found(search()) == ["doc-b:0", "doc-a:0"]
    with serve(other, "http://chroma2.test"):
        assert found(search(chroma_url="http://chroma2.test")) == ["x:0", "x:1"]


def test_a_passage_deleted_after_the_index_was_built_is_left_out(chroma):
    chroma.add("ws_ouc", passages())
    assert found(search()) == ["doc-b:0", "doc-a:0"]

    # Same count, so the cached index (which still has doc-b:0) is reused.
    del chroma.rows("ws_ouc")["doc-b:0"]
    chroma.rows("ws_ouc")["doc-z:0"] = ("Unrelated.", {"document_id": "doc-z"}, [0.0, 1.0, 0.0])

    result = search().get_passages().data["passages"]
    assert [(p["rank"], p["id"]) for p in result] == [(1, "doc-a:0")]
