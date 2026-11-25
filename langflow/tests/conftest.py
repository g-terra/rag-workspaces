"""Shared fixtures for the component tests.

The components run against Langflow's real framework (lfx). Nothing reaches the network: HTTP is mocked with
respx, Chroma is `fakes.FakeChroma`, and embeddings come from `fakes.FakeEmbeddings`.
"""

import sys

import pytest


@pytest.fixture(autouse=True)
def _fresh_caches():
    """chroma_search and web_page keep caches in modules registered in sys.modules, which outlive a test."""
    for name in ("rag_workspaces_search_cache", "rag_workspaces_web_cache"):
        module = sys.modules.get(name)
        for attr in ("indexes", "robots"):
            if module is not None and isinstance(getattr(module, attr, None), dict):
                getattr(module, attr).clear()
    yield


@pytest.fixture
def chroma():
    """A fake Chroma server at fakes.URL for the duration of the test."""
    from fakes import FakeChroma, serve

    fake = FakeChroma()
    with serve(fake):
        yield fake
