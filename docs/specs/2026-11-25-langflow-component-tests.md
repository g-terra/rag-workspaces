---
title: Unit tests for the custom Langflow components
date: 2026-11-25
pr: "#133"
status: in review
areas: [langflow-client, flows, ci]
---

# Unit tests for the custom Langflow components

## Summary

The eight custom Langflow components in `langflow/components/rag_workspaces/` now have pytest unit
tests in `langflow/tests/`, one file per component. They run against Langflow's real component
framework (`lfx==1.13.3`, the version inside the `langflowai/langflow:1.13.3` image) with every HTTP
call mocked, so they need no Docker, model or Chroma. `pnpm test:langflow` runs them locally and a new
`Langflow components` job runs them in CI on every pull request.

## Why

Architecture goal 9 (`docs/architecture.md`): tests at every layer, running in CI. Until now the
components, which hold the ingestion and retrieval logic (splitting, metadata, hybrid ranking,
idempotent re-ingest), were only exercised indirectly: by the flow contract test
(`apps/api/src/flows.test.ts`, which checks node ids, not behaviour) and by the compose smoke test
(`2026-11-22-compose-smoke-test.md`, which runs nightly and on stack PRs, takes about 5 minutes and
covers one happy path). A ranking or metadata regression could pass both. The COS512 report would
otherwise have to list the components as untested.

## Design

- `langflow/requirements-test.txt`: what the tests need, pinned. `lfx==1.13.3` plus the libraries the
  components import, at the versions in Langflow 1.13.3's `uv.lock` (so the tests see what the container
  runs), and `pytest` and `respx` (mocks `httpx`).
- `langflow/pytest.ini`: `pythonpath = components tests`, `testpaths = tests`, so tests import
  `rag_workspaces.<module>` the way Langflow loads them, and the shared fakes as `fakes`. lfx's own
  pydantic deprecation warnings are filtered.
- `langflow/tests/fakes.py`: `FakeEmbeddings` (fixed vectors per text, records the documents and queries
  it was given) and `FakeChroma`, an in-memory stand-in for the Chroma v2 REST routes the components call
  (collections get/create, `count`, `get` by ids, where or page, `upsert`, `delete`, `query`), served
  through respx at `http://chroma.test`. It records every call and body, so tests can check order (delete
  before upsert) and which vectors were read.
- `langflow/tests/conftest.py`: the `chroma` fixture, and an autouse fixture that clears the module-level
  caches `chroma_search` and `web_page` keep in `sys.modules`, so tests don't leak indexes or robots.txt
  into each other.
- One test file per component. Components are built with their inputs as keyword arguments and their
  output method is called directly. What each covers:
  - `test_document_loader.py`: PDF page numbers (a PDF built in the test with pypdf), DOCX, MD/TXT,
    transcript rows (grouped by characters and seconds, keeping `start_seconds`/`end_seconds`), folder
    metadata, path traversal outside `base_dir` refused, unsupported type, missing file, a document with
    no text.
  - `test_text_splitter.py`: a numbered list that fits a chunk stays with the sentence before it, cuts
    prefer paragraph, line and sentence boundaries, every chunk keeps its row's `page`/`start_seconds`,
    each row is split on its own, overlap, empty input.
  - `test_lmstudio_embeddings.py`: requests to an OpenAI-compatible `/embeddings` endpoint send plain
    strings (not token ids), document and query prefixes are added only when set.
  - `test_chroma_upsert.py`: get-or-create with the HNSW settings, the document's old vectors are deleted
    before the upsert, batching, ids `<document_id>:<n>`, metadata kept (scalars only) with
    `document_id`/`chunk_index`, blank chunks dropped, no chunks is an error, page count in the result.
  - `test_chroma_delete.py`: deletes by `document_id` and reports the count; a missing collection is 0.
  - `test_chroma_search.py`: the pure functions (`words`, `fuse`, `interleave`, `question_parts`,
    `KeywordIndex`, `VectorIndex`, `clock`) and the component against a fake Chroma: a passage found only
    by its rare word is ranked by BM25, results fused with RRF, `min_score` drops low cosine scores, the
    folder filter, top-k, a missing collection gives no passages, the context output's `[n]` tags with
    page or timestamp, and the index cache (reused, rebuilt when the count changes).
  - `test_chat_model.py`: provider selection builds the right LangChain class with the model, key, base
    URL and temperature; `reasoning_effort` goes only to LM Studio/OpenAI; an unknown provider raises.
  - `test_web_page.py`: `sitemap_urls`, `read_sitemaps` (indexes, gzip, other origins skipped, missing
    first-level sitemap, file cap), `strip_llms_note`, `page_links`, `main_markdown` drops navigation and
    sidebars, robots.txt blocking, the Markdown twin, non-HTML skipped, an error reported rather than
    raised. The page tests list their test hosts in `CRAWL_ALLOWED_HOSTS`, the component's own way past
    the SSRF guard (which resolves DNS); one test checks the guard still refuses a private address and a
    host in `LANGFLOW_SSRF_ALLOWED_HOSTS`, which need no DNS.
- `package.json`: `test:langflow` runs `uv run --no-project --python 3.12 --with-requirements
  langflow/requirements-test.txt pytest -c langflow/pytest.ini`. uv builds and caches the environment, so
  there is no virtualenv to manage.
- `.github/workflows/ci.yml`: a `langflow` job ("Langflow components": `astral-sh/setup-uv` with its
  cache keyed on `requirements-test.txt`, then the same `uv run ... pytest` as `pnpm test:langflow`,
  without installing Node) next to the existing `check` job, on every pull request and push to `main`.
- `langflow/components/rag_workspaces/document_loader.py`: one fix the tests found. A DOCX with no text
  gave a row with empty text, which passed the loader's "No text could be extracted" check and failed
  later in the splitter with "No text to split". It now fails in the loader, like an empty PDF.
  `flows/ingest.json` carries the component's code, so its Loader node gets the same change (the flow
  contract test in `apps/api/src/flows.test.ts` checks they match).
- `.gitignore`: `__pycache__/` and `.pytest_cache/`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Test against the real `lfx==1.13.3` from PyPI | Stub `lfx` in a conftest; run pytest inside the `langflowai/langflow:1.13.3` image | Stubs would test a fake `Component` and `DataFrame`. The image is an exact match but a multi-GB pull and needs Docker for a unit test. `lfx` installs in seconds and is the framework the image runs. |
| Pin library versions to Langflow 1.13.3's `uv.lock` | Unpinned, or latest | The tests should fail on what the container runs, not on a newer langchain. |
| `respx` for HTTP mocks | `pytest-httpx`; hand-written `httpx.MockTransport` | The components create their own `httpx.Client`, so a global router is the least code; respx is small and widely used. |
| uv via a pnpm script | A committed virtualenv recipe; `pip install` in CI | One command locally and in CI, cached, no activation step. |
| Fix bugs the tests find in this PR | Leave them for a follow-up | A failing test with no fix can't merge; each fix is called out in the PR. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. Running the tests needs [uv](https://docs.astral.sh/uv/) on the machine.
- **Data**: None.
- **Langflow**: `flows/ingest.json`'s Loader node carries the fixed `document_loader.py`. Inputs, outputs
  and node ids are unchanged. An existing install picks it up when Langflow restarts (it imports `flows/*.json` on every start).
- **Events and logs**: None.

## Operations

None. Nothing in the running stack changes. Developers need uv installed to run `pnpm test:langflow`.

## Testing

`pnpm test:langflow` runs `langflow/tests/test_*.py` (84 tests, about 10 seconds after the first
environment build). CI runs the same command in the `Langflow components` job.

The tests were checked against deliberate breakage, each caught by at least one test: the splitter cutting
at spaces only; search without BM25, without `min_score`, without the keyword folder filter, without
question parts, or re-reading every vector; upsert without the delete; the chat model dropping
`reasoning_effort`; the web page ignoring robots.txt, following other-origin sitemaps, keeping chrome, or
skipping the scope's own sitemap.

## Out of scope and follow-ups

- Coverage of Langflow's own SSRF guard (`lfx.utils.ssrf_protection`) and of the real providers' APIs.
- The flows end to end stay with the compose smoke test.

## Docs updated

- `AGENTS.md` and `CONTRIBUTING.md`: the `pnpm test:langflow` command.
- `docs/architecture.md`: pytest in the tests row of the tech table.
