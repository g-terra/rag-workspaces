# Spike: Langflow's native knowledge bases

Can Langflow 1.13.3's built-in Knowledge component (with its knowledge-base storage) replace
our Chroma components (decision 20, `poc/RESULTS.md` F1)? The verdict and findings are in
[RESULTS.md](RESULTS.md). Nothing here is used by the app.

## What's here

| File | Purpose |
|---|---|
| `docker-compose.yml` | Langflow 1.13.3 + Postgres with pgvector; mounts the POC's document loader and this spike's delete component |
| `Dockerfile` | The Langflow image plus the `pgvector` package the Postgres backend needs (F1) |
| `components/kb_spike/knowledge_delete.py` | Deletes one document's chunks from a knowledge base (F4) |
| `run-spike.ts` | Builds three flows (ingest, retrieve, delete), runs every check, writes `results/` |
| `up.sh` | Writes `.env` on first run, builds and starts the stack, waits for Langflow |

## Run it

Needs Docker, Node 22.18+ and an OpenAI-compatible model server on port 1234.

```sh
node ../../poc/standin/server.ts &      # or start LM Studio with an embedding model loaded
./up.sh
node run-spike.ts                        # Postgres backend
SPIKE_BACKEND=sqlite node run-spike.ts   # SQLite backend
docker compose down -v
```

With LM Studio instead of the stand-in: `SPIKE_EMBED_MODEL=<model id> SPIKE_MODEL_SERVER_LOG= node run-spike.ts`.
The SQLite backend also works on the stock `langflowai/langflow:1.13.3` image without the
`Dockerfile`; that is how the SQLite results were produced.
