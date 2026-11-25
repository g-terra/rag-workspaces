# Langflow proof of concept

A throwaway stack that checks the Langflow assumptions the plan depends on before
we build on them. Results and what they mean for the plan are in
[RESULTS.md](RESULTS.md). Whether each custom component was really needed, checked against the
Langflow 1.13.3 source, is in [STOCK-COMPONENTS.md](STOCK-COMPONENTS.md).
Twenty questions with known answers, asked of the tool and of Codex, are in [answer-key/](answer-key/README.md).

**Pinned versions tested:** Langflow `1.13.3` (`langflowai/langflow:1.13.3`),
ChromaDB `1.5.9` (`chromadb/chroma:1.5.9`), Node 22.23.

## What is here

| Path | What it is |
|---|---|
| `docker-compose.yml` | Langflow + ChromaDB. The model server runs on the host, like LM Studio will. |
| `components/rag_workspaces/` | Six small custom Langflow components (Python), loaded via `LANGFLOW_COMPONENTS_PATH`: document loader, LM Studio embeddings, a chat model whose provider is set per request, and Chroma upsert, search and delete. Why they exist is in RESULTS.md. |
| `flows/*.json` | `rag-ingest`, `rag-retrieve`, `rag-answer`, `rag-delete`. Imported automatically on startup via `LANGFLOW_LOAD_FLOWS_PATH`. |
| `client/lib.ts` | Tiny typed client for Langflow's login, API key, flows and run (incl. streaming) endpoints, plus Chroma REST helpers. |
| `client/bootstrap.ts` | The startup automation the API will run: log in with auto-login off, upsert flows, mint and rotate an API key. |
| `client/run-poc.ts` | The end-to-end checks. Writes `results/results.json` and `results/summary.md`. |
| `client/build-flows.ts` | Dev tool that regenerated `flows/*.json` from the running Langflow's component templates. Not needed to run the POC. |
| `standin/server.ts` | A stand-in for LM Studio's OpenAI-compatible server, plus Anthropic's Messages API (hashed bag-of-words embeddings, a canned streamed answer, and a request log). It is not a model: it proves plumbing only. |
| `samples/` | One PDF (3 pages), DOCX and MD in `ouc/`, one TXT in `personal/`. Mounted read-only at `/data/uploads`, standing in for the API's uploads volume. |

No npm install is needed: everything uses Node's built-ins and runs `.ts` files directly (Node 22.18+).

## Run it with the stand-in (no LM Studio needed)

```bash
cd poc
node standin/server.ts &        # OpenAI-compatible stand-in on :1234
scripts/up.sh                   # writes .env with a valid secret on first run, starts the stack
node client/run-poc.ts          # prints PASS/FAIL per check, exits non-zero on any failure
docker compose down -v          # clean up
```

Langflow's UI is at http://localhost:7860 (user `admin`, password in `.env`) if you want to open the flows.

## Rerun against LM Studio

1. In LM Studio, download two embedding models and two chat models, for example
   `text-embedding-nomic-embed-text-v1.5`, `text-embedding-bge-small-en-v1.5`,
   `qwen2.5-7b-instruct` and `llama-3.2-3b-instruct`. Any will do.
2. Start the server on port 1234 (Developer tab, Start Server). On Linux, also turn on
   **Serve on Local Network**, because containers reach the host through the Docker bridge,
   not localhost. On macOS and Windows with Docker Desktop, localhost is enough.
3. Stop the stand-in if it is running (`pkill -f standin/server.ts`), then:

```bash
curl -s localhost:1234/v1/models | grep '"id"'      # copy the exact model ids
scripts/up.sh
POC_EMBED_MODELS=text-embedding-nomic-embed-text-v1.5,text-embedding-bge-small-en-v1.5 \
POC_CHAT_MODELS=qwen2.5-7b-instruct,llama-3.2-3b-instruct \
POC_MODEL_SERVER_LOG= \
node client/run-poc.ts
```

`POC_MODEL_SERVER_LOG=` (empty) tells the runner there is no stand-in log, so the two
checks that read it switch to their LM Studio variants: the model-tweak checks rely on the
second model actually serving the ingest and query, and the unknown-model check
expects LM Studio to reject a model it does not have. The prompt-tweak check is skipped,
since only the stand-in can show the prompt it received.

Expect higher similarity scores than with the stand-in, and real answers. If a check fails,
`results/results.json` has the full detail.

## Real cloud provider calls (optional)

The provider checks use the stand-in unless you pass keys. With keys they make real calls
(`gpt-4o-mini`, `claude-haiku-4-5`, `gemini-2.5-flash`):

```bash
POC_OPENAI_API_KEY=sk-... POC_ANTHROPIC_API_KEY=sk-ant-... POC_GEMINI_API_KEY=... node client/run-poc.ts
```

## Regenerating the flows

The flow JSON was generated from the live component templates so it matches the pinned
Langflow version exactly. After changing a component or the flow layout:

```bash
node client/build-flows.ts && scripts/reload.sh
```
