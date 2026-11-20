"""OpenAI-compatible embeddings for LM Studio (or any local server).

The built-in OpenAI Embeddings component cannot be used against LM Studio in
Langflow 1.13: with tiktoken on, LangChain sends token-id arrays (LM Studio wants
strings), and with tiktoken off it downloads a Hugging Face tokenizer to check
context length. This component turns that check off, so plain strings are sent
and nothing is downloaded.
"""

from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

from lfx.custom.custom_component.component import Component
from lfx.io import IntInput, MessageTextInput, Output, SecretStrInput


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
    ]
    outputs = [Output(display_name="Embeddings", name="embeddings", method="build_embeddings", types=["Embeddings"])]

    def build_embeddings(self) -> Embeddings:
        return OpenAIEmbeddings(
            base_url=self.base_url,
            model=self.model,
            api_key=self.api_key or "lm-studio",
            check_embedding_ctx_length=False,
            tiktoken_enabled=False,
            chunk_size=self.chunk_size,
        )
