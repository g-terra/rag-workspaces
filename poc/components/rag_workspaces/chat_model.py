"""One chat-model node whose provider is chosen per request.

The workspace's model provider is a setting (LM Studio by default; OpenAI,
Anthropic or Gemini as options), so the API passes provider, model_name and
api_key as tweaks and one answer flow serves every workspace. The API holds the
provider keys and sends them per request; Langflow's environment holds none.
"""

from lfx.base.models.model import LCModelComponent
from lfx.field_typing import LanguageModel
from lfx.io import DropdownInput, FloatInput, MessageTextInput, SecretStrInput

DEFAULT_BASE_URLS = {"lmstudio": "http://host.docker.internal:1234/v1"}


class WorkspaceChatModel(LCModelComponent):
    display_name = "Workspace Chat Model"
    description = "Chat model whose provider (LM Studio, OpenAI, Anthropic, Gemini) is set per request."
    icon = "brain-circuit"
    name = "WorkspaceChatModel"

    inputs = [
        *LCModelComponent.get_base_inputs(),
        DropdownInput(name="provider", display_name="Provider", options=["lmstudio", "openai", "anthropic", "gemini"],
                      value="lmstudio", combobox=True),
        MessageTextInput(name="model_name", display_name="Model", value="qwen2.5-7b-instruct"),
        SecretStrInput(name="api_key", display_name="API Key", value="lm-studio", load_from_db=False,
                       info="Sent by the API per request. LM Studio ignores it."),
        MessageTextInput(name="base_url", display_name="Base URL", advanced=True,
                         info="Defaults: LM Studio on the host; each cloud provider's own endpoint."),
        FloatInput(name="temperature", display_name="Temperature", value=0.2),
    ]

    def build_model(self) -> LanguageModel:
        provider = (self.provider or "lmstudio").lower()
        base_url = self.base_url or DEFAULT_BASE_URLS.get(provider)
        common = {"temperature": self.temperature}
        if provider in {"lmstudio", "openai"}:
            from langchain_openai import ChatOpenAI

            return ChatOpenAI(model=self.model_name, api_key=self.api_key or "lm-studio", base_url=base_url,
                              stream_usage=True, **common)
        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic

            kwargs = {"base_url": base_url} if base_url else {}
            return ChatAnthropic(model=self.model_name, api_key=self.api_key, max_tokens=1024, **kwargs, **common)
        if provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(model=self.model_name, google_api_key=self.api_key, **common)
        msg = f"Unknown provider: {provider}"
        raise ValueError(msg)
