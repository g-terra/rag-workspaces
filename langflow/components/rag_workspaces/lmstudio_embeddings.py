"""OpenAI-compatible embeddings for LM Studio (or any local server).

The built-in OpenAI Embeddings component cannot be used against LM Studio in
Langflow 1.13: with tiktoken on, LangChain sends token-id arrays (LM Studio wants
strings), and with tiktoken off it downloads a Hugging Face tokenizer to check
context length. This component turns that check off, so plain strings are sent
and nothing is downloaded.

It also puts the model's task prefixes before each text: some models (nomic-embed-text, Qwen3-Embedding)
were trained with one for documents and another for queries, and search is weaker without them. The API
sends the prefixes pinned on the workspace.
"""

from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

from lfx.custom.custom_component.component import Component
from lfx.io import IntInput, MessageTextInput, Output, SecretStrInput, StrInput


class PrefixedEmbeddings(Embeddings):
    """Puts a prefix before every document and every query, then embeds with the wrapped model."""

    def __init__(self, inner: Embeddings, document_prefix: str, query_prefix: str) -> None:
        self.inner = inner
        self.document_prefix = document_prefix
        self.query_prefix = query_prefix

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.inner.embed_documents([self.document_prefix + t for t in texts])

    def embed_query(self, text: str) -> list[float]:
        return self.inner.embed_query(self.query_prefix + text)


class LMStudioEmbeddings(Component):
    display_name = "LM Studio Embeddings"
    description = "Embeddings from an OpenAI-compatible server such as LM Studio."
    icon = "binary"
    name = "LMStudioEmbeddings"

    inputs = [
        MessageTextInput(name="base_url", display_name="Base URL", value="http://host.docker.internal:1234/v1"),
        MessageTextInput(name="model", display_name="Model", value="text-embedding-nomic-embed-text-v1.5"),
        SecretStrInput(name="api_key", display_name="API Key", value="lm-studio", load_from_db=False,
                       info="LM Studio ignores it, but the client needs a non-empty value."),
        IntInput(name="chunk_size", display_name="Batch Size", value=64, advanced=True),
        StrInput(name="document_prefix", display_name="Document Prefix", value="", advanced=True,
                 info="Put before each document, e.g. 'search_document: ' for nomic-embed-text."),
        StrInput(name="query_prefix", display_name="Query Prefix", value="", advanced=True,
                 info="Put before each search query, e.g. 'search_query: ' for nomic-embed-text."),
    ]
    outputs = [Output(display_name="Embeddings", name="embeddings", method="build_embeddings", types=["Embeddings"])]

    def build_embeddings(self) -> Embeddings:
        inner = OpenAIEmbeddings(
            base_url=self.base_url,
            model=self.model,
            api_key=self.api_key or "lm-studio",
            check_embedding_ctx_length=False,
            tiktoken_enabled=False,
            chunk_size=self.chunk_size,
        )
        if not self.document_prefix and not self.query_prefix:
            return inner
        return PrefixedEmbeddings(inner, self.document_prefix or "", self.query_prefix or "")
