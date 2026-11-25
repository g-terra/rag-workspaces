import pytest
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from rag_workspaces.chat_model import WorkspaceChatModel


def build(**inputs):
    return WorkspaceChatModel(model_name="some-model", temperature=0.3, **inputs).build_model()


def test_lmstudio_is_the_default_and_talks_to_the_host():
    model = build(api_key="")

    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "some-model"
    assert model.openai_api_base == "http://host.docker.internal:1234/v1"
    assert model.openai_api_key.get_secret_value() == "lm-studio"
    assert model.temperature == 0.3
    assert model.reasoning_effort is None
    assert model.stream_usage is True  # token counts for usage analytics


def test_reasoning_effort_goes_to_lmstudio_and_openai_when_set():
    assert build(provider="lmstudio", reasoning_effort=" none ").reasoning_effort == "none"
    openai = build(provider="OpenAI", api_key="sk-test", reasoning_effort="low")

    assert isinstance(openai, ChatOpenAI)
    assert openai.reasoning_effort == "low"
    assert openai.openai_api_key.get_secret_value() == "sk-test"
    assert openai.openai_api_base is None  # OpenAI's own endpoint


def test_a_base_url_overrides_the_default():
    assert build(base_url="http://other:1234/v1").openai_api_base == "http://other:1234/v1"


def test_anthropic_gets_the_key_and_no_reasoning_effort():
    model = build(provider="anthropic", api_key="sk-ant-test", reasoning_effort="high")

    assert isinstance(model, ChatAnthropic)
    assert model.model == "some-model"
    assert model.anthropic_api_key.get_secret_value() == "sk-ant-test"
    assert model.max_tokens == 1024
    assert model.temperature == 0.3
    assert "reasoning_effort" not in model.model_kwargs
    assert build(provider="anthropic", api_key="k", base_url="http://proxy:8080").anthropic_api_url == "http://proxy:8080"


def test_gemini_gets_the_key():
    model = build(provider="gemini", api_key="gm-test")

    assert isinstance(model, ChatGoogleGenerativeAI)
    assert model.model.endswith("some-model")
    assert model.google_api_key.get_secret_value() == "gm-test"
    assert model.temperature == 0.3


def test_an_unknown_provider_is_an_error():
    with pytest.raises(ValueError, match="Unknown provider: mistral"):
        build(provider="mistral")
