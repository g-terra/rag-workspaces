import json

import httpx
import pytest
import respx

from rag_workspaces.lmstudio_embeddings import LMStudioEmbeddings, PrefixedEmbeddings

BASE = "http://lmstudio.test/v1"


@pytest.fixture
def lmstudio():
    """An OpenAI-compatible /embeddings endpoint that records each request's input."""
    inputs: list = []

    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        inputs.append(body["input"])
        data = [{"object": "embedding", "index": i, "embedding": [float(i), 1.0]} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"object": "list", "data": data, "model": body["model"],
                                         "usage": {"prompt_tokens": 1, "total_tokens": 1}})

    with respx.mock(assert_all_called=False) as router:
        router.post(f"{BASE}/embeddings").mock(side_effect=reply)
        yield inputs


def build(**inputs):
    return LMStudioEmbeddings(base_url=BASE, model="nomic", api_key="", **inputs).build_embeddings()


def test_sends_plain_strings_in_batches_without_downloading_a_tokenizer(lmstudio):
    embeddings = build(chunk_size=2)

    vectors = embeddings.embed_documents(["alpha", "beta", "gamma"])

    assert lmstudio == [["alpha", "beta"], ["gamma"]]  # strings, not token ids
    assert vectors == [[0.0, 1.0], [1.0, 1.0], [0.0, 1.0]]
    assert not isinstance(embeddings, PrefixedEmbeddings)


def test_puts_the_document_and_query_prefixes_before_each_text(lmstudio):
    embeddings = build(document_prefix="search_document: ", query_prefix="search_query: ")

    embeddings.embed_documents(["a passage"])
    embeddings.embed_query("a question")

    assert lmstudio == [["search_document: a passage"], ["search_query: a question"]]


def test_one_prefix_alone_leaves_the_other_side_untouched(lmstudio):
    embeddings = build(query_prefix="Q: ")

    embeddings.embed_documents(["doc"])
    embeddings.embed_query("ask")

    assert lmstudio == [["doc"], ["Q: ask"]]
