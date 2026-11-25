---
title: Unit tests for the custom Langflow components
date: 2026-11-25
pr: "#133"
status: in review
areas: [flows, ci]
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

- `langflow/requirements-test.in`: what the tests import directly, unpinned: `lfx` (Langflow's component
  framework), the libraries the components import, `pytest` and `respx` (mocks `httpx`).
- `langflow/requirements-test.txt`: the full environment (about 145 packages, transitive ones too), pinned
  to the versions in Langflow's `uv.lock` at tag `v1.13.3` for Python 3.14 on Linux, which is what
  `langflowai/langflow:1.13.3` runs (its Dockerfile builds on `ubi10/python-314-minimal`). Every pin
  matches the lock except `lfx` and `langflow-sdk`, which are Langflow's own workspace packages and are not
  in it (`lfx` is pinned to `1.13.3`). Fully pinned, a new upstream release can't turn this job red.
- `langflow/pin-test-requirements.py`: regenerates `requirements-test.txt` for a Langflow tag (`uv run
  --no-project --with packaging python pin-test-requirements.py v1.13.3`, from `langflow/`). It reads that
  tag's `uv.lock`, picks each package's version for Python 3.14 on Linux, and runs `uv pip compile` on
  `requirements-test.in` with those versions as constraints. Run it when the stack's Langflow is upgraded.
- `langflow/pytest.ini`: `pythonpath = components tests`, `testpaths = tests`, so tests import
  `rag_workspaces.<module>` the way Langflow loads them, and the shared fakes as `fakes`. Deprecation
  warnings from lfx, pydantic and Google's SDK are filtered.
- `langflow/tests/fakes.py`: `FakeEmbeddings` (fixed vectors per text, records the documents and queries
  it was given) and `FakeChroma`, an in-memory stand-in for the Chroma v2 REST routes the components call
  (collections get/create, `count`, `get` by ids, where or page, `upsert`, `delete`, `query`), served
  through respx at `http://chroma.test`. It records every call and body, so tests can check order (delete
  before upsert) and which vectors were read. Where real Chroma would refuse a request the components must
  not send, the fake refuses too: creating an existing collection without `get_or_create` (409), a delete
  with no `where`, a `where` with several keys and no `$and`.
- `langflow/tests/conftest.py`: the `chroma` fixture and two autouse fixtures. One clears the module-level
  caches `chroma_search` and `web_page` keep in `sys.modules`, so tests don't leak indexes or robots.txt
  into each other. The other makes every test independent of the shell: it unsets
  `LANGFLOW_SSRF_ALLOWED_HOSTS` and `CRAWL_ALLOWED_HOSTS`, sets `LANGFLOW_SSRF_PROTECTION_ENABLED=true`
  (Langflow's default), and replaces `socket.getaddrinfo` so an IP address resolves to itself and any name
  fails. No test touches the network or DNS.
- One test file per component. Components are built with their inputs as keyword arguments and their
  output method is called directly. What each covers:
  - `test_document_loader.py`: PDF page numbers (a PDF built in the test with pypdf), DOCX, MD/TXT,
    transcript rows (grouped by characters and seconds, keeping `start_seconds`/`end_seconds`), folder
    metadata, path traversal outside `base_dir` refused, unsupported type, missing file, a document with
    no text, and PDF pages too complex for pypdf skipped and named.
  - `test_text_splitter.py`: a numbered list that fits a chunk stays with the sentence before it, cuts
    prefer paragraph, line and sentence boundaries, every chunk keeps its row's `page`/`start_seconds`,
    each row is split on its own, overlap, empty input.
  - `test_lmstudio_embeddings.py`: requests to an OpenAI-compatible `/embeddings` endpoint send plain
    strings (not token ids), document and query prefixes are added only when set.
  - `test_chroma_upsert.py`: get-or-create with the HNSW settings, the document's old vectors are deleted
    before the upsert, batching, ids `<document_id>:<n>`, metadata kept (scalars only) with
    `document_id`/`chunk_index`, blank chunks dropped, no chunks is an error, page count in the result, an
    existing collection reused.
  - `test_chroma_delete.py`: deletes by `document_id` and reports the count; a missing collection is 0.
  - `test_chroma_search.py`: the pure functions (`words`, `fuse`, `interleave`, `question_parts`,
    `KeywordIndex`, `VectorIndex`, `clock`) and the component against a fake Chroma: a passage found only
    by its rare word is ranked by BM25, results fused with RRF, `min_score` drops low cosine scores, the
    folder filter, top-k, a missing collection gives no passages, the context output's `[n]` tags with
    page or timestamp, scores against the whole question for a multi-part one, a passage deleted after the
    index was built left out, Chroma's own vector search for a collection too big to cache, and the index
    cache (reused, reading only new vectors when the count changes, rebuilt after `INDEX_TTL_SECONDS`, never
    shared between two Chroma servers).
  - `test_chat_model.py`: provider selection builds the right LangChain class with the model, key, base
    URL and temperature, usage streamed for analytics; `reasoning_effort` goes only to LM Studio/OpenAI; an
    unknown provider raises.
  - `test_web_page.py`: `sitemap_urls`, `read_sitemaps` (indexes, gzip, other origins skipped, missing
    first-level sitemap, file cap), `strip_llms_note`, `page_links`, `main_markdown` drops navigation and
    sidebars and `role=` chrome, robots.txt blocking and its cache, the Markdown twin (query dropped, only a
    Markdown or text type accepted), non-HTML skipped, an error reported rather than raised. The page tests
    list their test hosts in `CRAWL_ALLOWED_HOSTS`, the component's own way past the SSRF guard. Other
    tests check the guard still refuses a private address, a host in `LANGFLOW_SSRF_ALLOWED_HOSTS`, and a
    redirect from an allowed site to a private address (each hop is checked again).
- `package.json`: `test:langflow` runs `cd langflow && uv run --managed-python --no-project --python 3.14
  --with-requirements requirements-test.txt pytest`. uv downloads its own Python 3.14 (a system Python
  can bring its distribution's packages and their pytest plugins along) and builds and caches the
  environment, so there is no virtualenv to manage.
- `.github/workflows/ci.yml`: a `langflow` job ("Langflow components": `astral-sh/setup-uv` with its
  cache keyed on `requirements-test.txt`, then the same `uv run ... pytest` as `pnpm test:langflow`,
  without installing Node) next to the existing `check` job, on every pull request and push to `main`.
- `.github/workflows/smoke.yml` and `e2e.yml`: their path filter narrows from `langflow/**` to
  `langflow/components/**`, so a change to the tests alone doesn't start the 5-minute stack runs.
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
| Pin the whole environment to Langflow 1.13.3's `uv.lock` for Python 3.14 | Pin only the direct libraries; unpinned | The tests should run what the container runs, and a new release of a transitive package (openai, pydantic, protobuf) must not turn CI red on an unrelated PR. Pinning only direct libraries left 78 of 148 packages off the lock. |
| A small script to regenerate the pins | Copy the versions by hand | 145 pins can't be kept in step with a Langflow upgrade by hand. |
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

`pnpm test:langflow` runs `langflow/tests/test_*.py` (93 tests, about 10 seconds after the first
environment build). CI runs the same command in the `Langflow components` job. They also pass with
`LANGFLOW_SSRF_PROTECTION_ENABLED=false`, `LANGFLOW_SSRF_ALLOWED_HOSTS` and `CRAWL_ALLOWED_HOSTS` set in the
shell, since the conftest overrides them.

The tests were checked against deliberate breakage, each caught by at least one test: the splitter cutting
at spaces only; search without BM25, without `min_score`, without the keyword folder filter, without
question parts, scoring against a part instead of the whole question, re-reading every vector, ignoring
the index's age, keying the index cache without the Chroma URL, or keeping a passage deleted since the
index was built; upsert without the delete or without `get_or_create`; the chat model dropping
`reasoning_effort`, `stream_usage` or Anthropic's base URL; the loader not skipping a too-complex PDF page;
the web page ignoring robots.txt or its cache, keeping the query on the twin URL, taking a twin of any
type, following other-origin sitemaps, keeping chrome or `role=` chrome, or skipping the scope's own
sitemap.

## Out of scope and follow-ups

- Langflow's own SSRF guard (`lfx.utils.ssrf_protection`) beyond the cases above, and the real providers'
  APIs.
- The pins follow the Langflow version by hand: `pin-test-requirements.py` is run when the stack's image
  tag changes.
- The flows end to end stay with the compose smoke test.

## Docs updated

- `AGENTS.md` and `CONTRIBUTING.md`: the `pnpm test:langflow` command, seven CI checks, and the smoke
  test's narrower `langflow/components` path.
- `docs/architecture.md`: `langflow/tests/` in the repo layout, pytest in the tests row of the tech table.
