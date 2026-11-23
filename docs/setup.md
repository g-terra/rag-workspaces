# Setup

How to run rag-workspaces on your own machine, from an empty clone to a first answer. The README has the
short version; this page explains each step and what to do when one goes wrong.

## What you need

| | Minimum | Recommended |
|---|---|---|
| Docker | Docker Desktop, or Docker Engine with Compose v2 | |
| Memory | 8 GB, with a hosted model provider | 16 GB or more with LM Studio, since the models need room beside the stack |
| Disk | About 5 GB for images and data | More for your material and local models |
| Node | Node 22.18+ and pnpm 10 (`corepack enable`), for `pnpm env:init` and the MCP server | |
| A model | [LM Studio](https://lmstudio.ai) on the same machine, or a key for OpenAI, Gemini or Anthropic | |

The containers (Postgres, Chroma, Langflow, Keycloak, the API, the admin UI and the proxy) use about 6 GB
together, most of it Keycloak and Langflow. The models LM Studio loads come on top of that.

## 1. Start the stack

The quick way is the setup wizard, which does steps 1 and 2 for you:

```bash
git clone https://github.com/g-terra/rag-workspaces.git
cd rag-workspaces
pnpm install             # tools, plus the commit-message hook
pnpm run setup           # not `pnpm setup`, which is pnpm's own command
```

It checks Node and Docker, checks the ports are free (naming the program that holds one), writes `.env`,
asks for the chat and embedding provider and model (listing the models LM Studio has loaded, or asking for
a hosted provider's key without showing it), starts the stack, waits for the API and prints where to sign
in. Run it again at any time to change the models or fix a broken setup: it keeps every secret and offers
the current values as defaults. `pnpm run setup --yes` asks nothing and keeps what `.env` has.

By hand, the same is:

```bash
pnpm env:init            # writes .env with fresh random passwords and keys
docker compose up -d     # the first start pulls about 2 GB of images and takes a few minutes
docker compose ps        # wait until every service says (healthy)
```

`.env` holds every password and key the stack uses. It is ignored by Git; never commit it.
`pnpm env:init` is safe to run again: it only adds values that are missing.

The README's table lists every address. The usual ones are http://rag.localhost (admin UI),
http://api.rag.localhost/docs (API and Swagger UI) and http://auth.rag.localhost/admin (Keycloak).

## 2. Set up the model

### LM Studio (the default, runs offline)

1. In LM Studio, download a chat model and an embedding model. The defaults in `.env` are
   `qwen2.5-7b-instruct` and `text-embedding-nomic-embed-text-v1.5`.
2. Load both, and start the local server (Developer tab, port 1234).
3. Check that the ids match `.env` exactly: `curl localhost:1234/v1/models`. If yours differ, set
   `DEFAULT_CHAT_MODEL` and `DEFAULT_EMBEDDING_MODEL` to them and run `docker compose up -d api`.

The containers reach LM Studio at `host.docker.internal:1234` (`LMSTUDIO_BASE_URL`).

### A hosted provider instead

Put the key in `.env` and point the defaults at it, then run `docker compose up -d api`:

| Provider | Key | Chat | Embeddings |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `DEFAULT_CHAT_PROVIDER=openai`, e.g. `gpt-4o-mini` | `DEFAULT_EMBEDDING_PROVIDER=openai`, e.g. `text-embedding-3-small` |
| Google Gemini | `GEMINI_API_KEY` | `gemini`, e.g. `gemini-2.0-flash` | `gemini`, e.g. `text-embedding-004` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic`, e.g. `claude-haiku-4-5` | none: use another provider for embeddings |

Keys stay in the API. It sends them to Langflow with each run, so they never sit in Langflow's own
environment (`poc/RESULTS.md`, F3). Each workspace can also pick its own chat model in its settings.

Every new workspace is pinned to the embedding model that is the default when it is created. To change a
workspace's embedding model later, reindex it (`POST /v1/workspaces/{slug}/reindex`), because vectors from
two models can't be compared.

### Check it

Signed in as an admin, `GET /v1/system` (or the admin UI's status banner) says whether each provider is
reachable and whether the default models are among the ones it offers. The usual problem is LM Studio not
running, or the model not loaded.

## 3. Sign in and add people

1. Open http://rag.localhost and sign in as `RW_ADMIN_USERNAME` with `RW_ADMIN_PASSWORD` from `.env`. That
   account is the first admin.
2. Create a workspace, for example `ouc`, from "All workspaces".
3. Upload files from "Upload": PDF, DOCX, TXT and Markdown, up to 200 MB each and 20 per upload. Each one
   goes `queued`, `processing`, `ready` (or `failed`, with the reason).

People are created in Keycloak's own admin console (http://auth.rag.localhost/admin, sign in with
`KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`, realm `rag-workspaces`, "Users"). Then give them access to a
workspace as `reader` or `editor` from its members page in the admin UI, or with
`PUT /v1/workspaces/{slug}/members/{userId} { "role": "reader" }` (`GET /v1/users` finds the user id). To make someone an admin, give them the realm role
`admin` in Keycloak.

## 4. Give an agent or script access

Agents and scripts use API keys, not people's accounts:

1. As an admin, create a key in the admin UI ("API keys"), or with `POST /v1/api-keys`.
2. Pick the role (`reader` to search and ask, `editor` to also upload) and the workspaces it may use.
3. Copy the secret (`rw_…`). It is shown only once.

Then follow [api.md](api.md) for the REST API, or the README's "Connect an agent (MCP)" for Claude Desktop,
Claude Code and other MCP clients.

## Stopping, updating, starting over

| To | Run |
|---|---|
| Stop, keeping your data | `docker compose down` |
| Update | `git pull`, then `pnpm run setup --yes`, or `pnpm env:init` and `docker compose up -d --build` (migrations run when the API starts) |
| Delete everything | `docker compose down -v` |

Keycloak reads `docker/keycloak/realm.json` only into an empty database, so the README's "Updating an
existing install" says what to change by hand when that file changes.

## When something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| `docker compose ps` shows a service `unhealthy` | `docker compose logs <service>`. Keycloak and Langflow are slow on the first start: give them a few minutes |
| Port 80 or another port is taken | Set `PROXY_PORT` (and the ports in the URLs), `API_PORT`, `WEB_PORT`, `LANGFLOW_PORT` or `KEYCLOAK_PORT` in `.env`. A Langflow already running on the host often holds 7860 |
| `rag.localhost` doesn't open | Some browsers and tools don't resolve `*.localhost`: add the `/etc/hosts` line from the README, or use the `localhost` ports |
| Documents stay `failed` with an embedding error | LM Studio isn't running, or the embedding model id doesn't match `DEFAULT_EMBEDDING_MODEL`. Fix it, then reindex the document |
| Answers fail with `502` or `504` | The chat model failed or timed out; check `GET /v1/system` and LM Studio's log |
| `429 Too Many Requests` | A rate limit (600 requests, 30 model calls a minute per person or key). Wait for `Retry-After`, or raise `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_MODEL_PER_MINUTE` in `.env` |
| `503` on search right after a reindex | The workspace is `reindexing`; it answers again once every document is `ready` |
