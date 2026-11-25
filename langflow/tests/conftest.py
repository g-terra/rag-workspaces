"""Shared fixtures for the component tests.

The components run against Langflow's real framework (lfx). Nothing reaches the network: HTTP is mocked with
respx, and embeddings come from `FakeEmbeddings`.
"""

import sys

import pytest
from langchain_core.embeddings import Embeddings


class FakeEmbeddings(Embeddings):
    """Vectors chosen by the test: `vectors[text]`, or `default` for any other text. Records every call."""

    def __init__(self, vectors: dict[str, list[float]] | None = None, default: list[float] | None = None) -> None:
        self.vectors = vectors or {}
        self.default = default or [1.0, 0.0, 0.0]
        self.documents: list[list[str]] = []
        self.queries: list[str] = []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.documents.append(list(texts))
        return [self.vectors.get(t, self.default) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        self.queries.append(text)
        return self.vectors.get(text, self.default)


@pytest.fixture(autouse=True)
def _fresh_caches():
    """chroma_search and web_page keep caches in modules registered in sys.modules, which outlive a test."""
    for name in ("rag_workspaces_search_cache", "rag_workspaces_web_cache"):
        module = sys.modules.get(name)
        for attr in ("indexes", "robots"):
            if module is not None and isinstance(getattr(module, attr, None), dict):
                getattr(module, attr).clear()
    yield
