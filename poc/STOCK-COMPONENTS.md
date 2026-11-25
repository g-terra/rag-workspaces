# Why custom components: checked against Langflow 1.13.3

Checked on 2026-11-25 against the Langflow source at tag `v1.13.3` (commit
[`55c4398`](https://github.com/langflow-ai/langflow/tree/55c4398326671f35c3a8d48a24e8243ab2b92f5b)), the
version this repo pins. Each row takes one reason given in [RESULTS.md](RESULTS.md) (F1, F2, F7), in
[decision 20](../docs/decisions.md) or in a component's docstring
([`langflow/components/rag_workspaces/`](../langflow/components/rag_workspaces/)), and says whether the
source bears it out. Links go to that commit, with line ranges, so they stay valid.

docs.langflow.org could not be reached from the environment that ran the check, so documentation is cited
from its source files in the same repository (`docs/docs/`). The page's live address is given where it
matters.

## Summary

| #   | Claim                                                                                         | Verdict   | Component                                            |
| --- | --------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 1   | Langflow 1.13 retired its Chroma component                                                    | Confirmed | `chroma_upsert.py`, `chroma_search.py`, `chroma_delete.py` |
| 2   | Split Text cuts at one separator only                                                         | Partly    | `text_splitter.py`                                   |
| 3   | The stock File loader loses PDF page numbers and transcript timestamps                        | Confirmed | `document_loader.py`                                 |
| 4   | OpenAI Embeddings can't talk to LM Studio, and nothing adds task prefixes                     | Partly    | `lmstudio_embeddings.py`                             |
| 5   | Language Model switches provider per request, but has no OpenAI-compatible base URL and no LM Studio | Partly    | `chat_model.py`                                      |
| 6   | The run API takes per-request tweaks that override component settings                        | Confirmed | (how the API drives every flow)                      |

## 1. Chroma retired: confirmed

The Chroma DB component still loads so old flows open, but building it raises
`ChromaMigrationRequiredError`, whose message says "Installing a Chroma package does not enable this
retired integration". The package marks it import-only and excluded from discovery.

- [`components/chroma/chroma.py` L85-87](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/chroma/chroma.py#L85-L87)
- [`base/knowledge_bases/backends/chroma.py` L14-25](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/base/knowledge_bases/backends/chroma.py#L14-L25) (the error text)

Report wording: "Langflow 1.13 retired its Chroma component: it now only raises a migration error, and
installing chromadb does not bring it back."

## 2. Text splitter: partly

- **One separator: confirmed.** Split Text builds LangChain's `CharacterTextSplitter` with the single
  `separator` field, and its own help text says a piece longer than the chunk size is not divided further.
  [`processing/split_text.py` L33-50](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/processing/split_text.py#L33-L50),
  [L152-158](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/processing/split_text.py#L152-L158)
- **Also found: metadata is not a reason.** Split Text keeps each input row's metadata on its chunks
  unless "Clean Output" is on, so carrying page numbers did not need our own splitter.
  [L79-85](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/processing/split_text.py#L79-L85)
- **A stock recursive splitter exists.** Langflow ships a Recursive Character Text Splitter (the same
  LangChain class ours uses). Its input is declared as Document, Data or JSON, not the Table/DataFrame the
  loader returns. Whether it could be wired in anyway was not tested.
  [`langchain_utilities/recursive_character.py` L10-60](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/langchain_utilities/recursive_character.py#L10-L60)

Report wording: "Langflow's Split Text cuts at a single separator, so lists were split mid-item. We use
LangChain's recursive splitter instead, with sentence-level separators, applied to the loader's per-page
rows."

## 3. Document loader: confirmed

In its basic mode the stock File component reads a PDF with pypdf and joins every page's text with blank
lines into one string. It returns one row with `file_path` and `text` only, so page numbers are gone. Any
other file is read as text, and JSON is parsed as one object, so a transcript gets no per-segment times.

- [`base/data/utils.py` L346-349](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/base/data/utils.py#L346-L349) (pages joined)
- [`base/data/utils.py` L391-414](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/base/data/utils.py#L391-L414) (the row it returns)

Not evaluated: the File component's optional "Advanced Parser" mode (Docling).

Report wording: "The stock File component joins all of a PDF's pages into one text and returns only the
file path and text, so page numbers are lost; a JSON transcript is read as one object, with no
per-segment times."

## 4. Embeddings: partly

- **Stock OpenAI Embeddings: confirmed.** It exposes `tiktoken_enable` (on by default; off needs
  `transformers`) but no setting for LangChain's `check_embedding_ctx_length`, and builds
  `OpenAIEmbeddings` without it. The token-array and tokenizer-download behaviour itself was observed in
  the POC run (RESULTS.md, F2).
  [`lfx_openai/components/openai/openai.py` L56-115](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/bundles/openai/src/lfx_openai/components/openai/openai.py#L56-L115)
- **But the newer Embedding Model node handles it.** Langflow 1.13.3's unified Embedding Model node sets
  `check_embedding_ctx_length=False` for its "OpenAI Compatible" provider, with a comment naming the same
  token-array problem, and it has an API Base URL field
  ([`embedding_model.py` L79-84](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/models_and_agents/embedding_model.py#L79-L84)).
  We have not tried it.
  [`unified_models/instantiation.py` L725-728](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/base/models/unified_models/instantiation.py#L725-L728)
- **No task prefixes: confirmed.** Neither node has an input that puts text before documents or queries.
  This is the reason that still stands on its own.

Report wording: "The OpenAI Embeddings component sends token arrays LM Studio rejects; more importantly,
no stock embedding node can add the task prefixes nomic-embed-text was trained with."

## 5. Chat model: partly

- **Per-request provider switch: confirmed.** The Language Model node has Provider and Model Name
  overrides.
  [`models_and_agents/language_model.py` L23-115](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/models_and_agents/language_model.py#L23-L115)
- **No OpenAI-compatible base URL: wrong as worded.** There is one, but only as a server-wide setting:
  the OpenAI provider's `OPENAI_BASE_URL` variable, or the "OpenAI Compatible" provider's
  `OPENAI_COMPATIBLE_BASE_URL`, set in Settings or the environment. The node itself has a URL input only
  for Ollama and watsonx, so the endpoint can't be set per node or per request, and one server holds one
  endpoint per provider.
  [`base/models/model_metadata.py` L114-125](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/base/models/model_metadata.py#L114-L125)
- **LM Studio bundle not installed: confirmed.** The LM Studio components moved to the opt-in
  `lfx-bundles` package, which is not a default dependency; the old import path raises "Install it with:
  pip install lfx-bundles".
  [`components/lmstudio/__init__.py` L1-21](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/lfx/src/lfx/components/lmstudio/__init__.py#L1-L21),
  [`pyproject.toml` L28-29](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/pyproject.toml#L28-L29)

Report wording: "Langflow's Language Model can switch provider per request, but an OpenAI-compatible
endpoint is set server-wide, not per node or request, and the LM Studio bundle isn't installed."

## 6. Tweaks: confirmed

The run API takes a `tweaks` object of one-time overrides of component settings for that run, keyed by
node id; the server applies them before building the graph.

- [`docs/Deployment/deployment-tweaks-policy.mdx` L7-10](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/docs/docs/Deployment/deployment-tweaks-policy.mdx#L7-L10)
  (live page: `https://docs.langflow.org/deployment-tweaks-policy`)
- [`docs/API-Reference/api-flows-run.mdx` L181](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/docs/docs/API-Reference/api-flows-run.mdx#L181)
- [`api/v1/endpoints.py` L510](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/backend/base/langflow/api/v1/endpoints.py#L510)

Two conditions this repo relies on: the default `LANGFLOW_TWEAKS_POLICY` is `permissive` (this repo does
not set it; `declared` would refuse tweaks to fields not marked for the API, once a flow marks any), and only the flow's owner may
send tweaks
([`endpoints.py` L151-157](https://github.com/langflow-ai/langflow/blob/55c4398326671f35c3a8d48a24e8243ab2b92f5b/src/backend/base/langflow/api/v1/endpoints.py#L151-L157)),
which holds because the API's Langflow key belongs to the user that imports the flows.

Report wording: "Langflow's run API accepts per-request tweaks that override component settings, so one
flow serves every workspace."
