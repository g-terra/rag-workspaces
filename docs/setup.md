# Setup

How to run rag-workspaces on your own machine, from an empty clone to a first answer. The README has the
quick start; this page explains each step and what to do when one goes wrong.

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
a hosted provider's key without showing it), offers to turn on video and audio transcription, starts the
stack, waits for the API and prints where to sign in. Run it again at any time to change the models or fix
a broken setup: it keeps every secret and offers the current values as defaults. `pnpm run setup --yes`
asks nothing and keeps what `.env` has.

By hand, the same is:

```bash
pnpm env:init            # writes .env with fresh random passwords and keys
docker compose up -d     # the first start pulls about 2 GB of images and takes a few minutes
docker compose ps        # wait until every service says (healthy)
```

`.env` holds every password and key the stack uses. It is ignored by Git; never commit it.
`pnpm env:init` is safe to run again: it only adds values that are missing.

### Where everything is

| What | Where | Also at | Login |
|---|---|---|---|
| Admin UI | http://rag.localhost | http://localhost:8080 | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD`, through Keycloak's sign-in page |
| API and Swagger UI | http://api.rag.localhost/docs | http://localhost:3000/docs | a Keycloak token or an `rw_` API key |
| Langflow editor | http://langflow.rag.localhost | http://localhost:7860 | `LANGFLOW_SUPERUSER` / `LANGFLOW_SUPERUSER_PASSWORD` from `.env` |
| Keycloak admin console (create people here) | http://auth.rag.localhost/admin | http://localhost:8081/admin | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` |
| rag-workspaces sign-in (realm `rag-workspaces`) | http://auth.rag.localhost/realms/rag-workspaces/account | | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD` |

The names come from a small proxy (Caddy, `docker/caddy/Caddyfile`) on port 80, over plain HTTP. Chrome, Firefox
and Edge send every `*.localhost` name to this machine by themselves, so there is nothing to set up. If a
browser or tool doesn't open them (some Safari versions, older curl), add this line to `/etc/hosts`:

```text
127.0.0.1 rag.localhost api.rag.localhost auth.rag.localhost langflow.rag.localhost
```

If port 80 is taken, set `PROXY_PORT` in `.env` (for example `8088`) and add the port to `KEYCLOAK_PUBLIC_URL`,
`ADMIN_UI_URL`, `PUBLIC_API_URL` and `LANGFLOW_PUBLIC_URL` (`http://rag.localhost:8088`,
`http://langflow.rag.localhost:8088`), then `docker compose up -d --build`. The
"Also at" ports keep working either way; Keycloak's pages always show at `KEYCLOAK_PUBLIC_URL`.

## 2. Set up the model

### LM Studio (the default, runs offline)

1. In LM Studio, download a chat model and an embedding model. The defaults in `.env` are
   `openai/gpt-oss-20b` (about 12 GB) and `text-embedding-nomic-embed-text-v1.5`. With memory to spare,
   `qwen3.6-35b-a3b` with `DEFAULT_REASONING_EFFORT=none` answered one question more of 15 in our tuning, at about 21 GB
   ([tuning.md](tuning.md)).
2. Load both, and start the local server (Developer tab, port 1234).
3. Check that the ids match `.env` exactly: `curl localhost:1234/v1/models`. If yours differ, set
   `DEFAULT_CHAT_MODEL` and `DEFAULT_EMBEDDING_MODEL` to them and run `docker compose up -d api`.

**Keep both models loaded.** If LM Studio loads models on demand ("just in time"), it keeps only the last
one by default (the `unloadPreviousJITModelOnLoad` setting, "Only Keep Last JIT Loaded Model" in the
server settings). Every question then swaps the embedding model for the chat model and back, about 5
seconds each way. Load both yourself once LM Studio is running, and they stay loaded:

```sh
lms load openai/gpt-oss-20b
lms load text-embedding-nomic-embed-text-v1.5
```

Use your ids from `.env`; `lms ls` lists what is downloaded. `pnpm run setup` offers to run these for you
when `lms` is installed.

The containers reach LM Studio at `host.docker.internal:1234` (`LMSTUDIO_BASE_URL`).

A thinking model such as Qwen 3 reasons before every answer by default, which can take minutes on a laptop.
Set `DEFAULT_REASONING_EFFORT=none` in `.env` (or a workspace's reasoning effort) to turn that off; LM Studio
honours it. Run `docker compose up -d api` after changing `.env`.

### A hosted provider instead

Put the key in `.env` and point the defaults at it, then run `docker compose up -d api`:

| Provider | Key | Chat | Embeddings |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `DEFAULT_CHAT_PROVIDER=openai`, e.g. `gpt-4o-mini` | `DEFAULT_EMBEDDING_PROVIDER=openai`, e.g. `text-embedding-3-small` |
| Google Gemini | `GEMINI_API_KEY` | `gemini`, e.g. `gemini-2.0-flash` | `gemini`, e.g. `text-embedding-004` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic`, e.g. `claude-haiku-4-5` | none: use another provider for embeddings |

Keys stay in the API. It sends them to Langflow with each run, so they never sit in Langflow's own
environment (`poc/RESULTS.md`, F3). Each workspace can also pick its own chat model in its settings, and
an admin can save a key for one workspace there instead of in `.env`. Saved keys are encrypted with
`SECRETS_KEY`, which `pnpm env:init` adds to `.env`; run it again on an older install, then
`docker compose up -d api`.

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
3. Upload files from "Upload": PDF, DOCX, TXT and Markdown, up to 2 GB each and 20 per upload
   (`MAX_UPLOAD_BYTES` in `.env` changes the size limit, for the API and the admin UI alike). Each one
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

Then follow [api.md](api.md) for the REST API, or [API keys and agents](guide/api-keys.md#connect-an-ai-agent-mcp)
for Claude Desktop, Claude Code and other MCP clients.

## Video and audio

MP4, MP3 and WAV files are transcribed by [Whisper](https://github.com/ahmetoner/whisper-asr-webservice)
first, and the transcript is what gets searched. It is optional because the image is about 1 GB and
transcribing takes a while. `pnpm run setup` asks whether to turn it on and which model to use, and starts
the stack so the model is downloaded before the first upload. By hand, uncomment these two lines in `.env`
and run `docker compose up -d`:

```bash
COMPOSE_PROFILES=video
WHISPER_URL=http://whisper:9000
```

- The first start downloads the Whisper model (`WHISPER_MODEL`, `base` by default, about 150 MB) into the
  `whisper-models` volume, so `whisper` takes a few minutes to become healthy.
- Transcription runs on the CPU and takes a while for long recordings, so try one file first. `small` is
  more accurate and slower than `base`; `tiny` is quicker and rougher.
- A file shows `transcribing`, then `processing`, then `ready`. The transcript is kept next to the file, so a
  reindex or retry doesn't transcribe again. `GET …/documents/{id}/transcript` returns it with timings.
- In the admin UI, "Upload" takes MP4, MP3 and WAV, and a ready recording's panel in "Documents" shows its
  transcript with the time each line starts. Sources in the playground say `at 12:34` instead of a page.
- Search results and citations from a recording carry `startSeconds`, the second their passage starts at
  (`page` stays `null`), so you can jump to that moment.
- Without the profile, video and audio uploads are refused with `415` and a message pointing here.
- Files can be up to `MAX_UPLOAD_BYTES` (see `.env`). For very long videos, uploading just the audio is
  quicker: `ffmpeg -i lecture.mp4 -vn -c:a libmp3lame -b:a 64k lecture.mp3`.

## Documentation websites

A workspace can import a documentation website: `POST /v1/workspaces/{slug}/sites` with `{ "url": "https://…" }`
(see docs/api-schema.md, "Imported websites"). Each page becomes a document whose citations link back to the page.

- The crawl is polite by default: one request a second (`CRAWL_DELAY_MS`), robots.txt honoured, one site at a time.
  A large site takes a while: about 2,300 pages of auth0.com/docs take roughly 40 minutes to fetch, and embedding them
  on LM Studio longer. Start with a small `maxPages` to check the result.
- Leave out translations and other parts with `excludePaths`, for example `["/docs/fr-ca/", "/docs/ja-jp/"]`.
- Langflow fetches the pages and refuses private and internal addresses. To import a site on your own network or on
  your machine, add its host to `LANGFLOW_SSRF_ALLOWED_HOSTS` in `docker-compose.yml` (comma-separated, next to
  `host.docker.internal`) and run `docker compose up -d langflow`.
- Sites that need JavaScript to show their text, or a login, are not supported.

## Stopping, updating, starting over

| To | Run |
|---|---|
| Stop, keeping your data | `docker compose down` |
| Update | `git pull`, then `pnpm run setup --yes`, or `pnpm env:init` and `docker compose up -d --build` (migrations run when the API starts) |
| Delete everything | `docker compose down -v` |


### Updating an existing install

Run `pnpm env:init` after pulling: it adds any new secret to your `.env` and leaves the rest alone. Keycloak
imports `docker/keycloak/realm.json` only into an empty database, so a realm created before a change to that
file keeps its old settings. The simplest fix on a test install is `docker compose down -v` (this deletes
the stack's data) and `docker compose up -d --build`. To keep your data instead, make the change by hand in
the Keycloak admin console; for the people list (`GET /v1/users`, added 2026-11-23) that means creating the
`api-directory` client as `realm.json` describes it, with `KEYCLOAK_DIRECTORY_SECRET` from `.env` as its
secret.
For the sign-in page styled like the admin UI (added 2026-11-23), run `docker compose up -d` so Keycloak
mounts the theme, then pick `rag-workspaces` as the login theme under Realm settings > Themes.

An install from before the local names (2026-11-23) keeps its `localhost` URLs, because `pnpm env:init`
never changes existing values, and keeps working as before. To move it to the names:

1. In `.env`, set `KEYCLOAK_PUBLIC_URL=http://auth.rag.localhost`, `ADMIN_UI_URL=http://rag.localhost` and
   `PUBLIC_API_URL=http://api.rag.localhost`.
2. In the Keycloak admin console (realm `rag-workspaces`, client `admin-ui`), add `http://rag.localhost/*` to
   the valid redirect URIs and post-logout redirect URIs, and `http://rag.localhost` to the web origins.
3. Run `docker compose up -d --build` (the admin UI has the Keycloak URL built in).

## When something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Something isn't working and you don't know what | Open "System" in the admin UI (admins): it shows each service and model provider with its error, and links to Langflow, Keycloak and Swagger |
| `docker compose ps` shows a service `unhealthy` | `docker compose logs <service>`. Keycloak and Langflow are slow on the first start: give them a few minutes |
| Port 80 or another port is taken | Set `PROXY_PORT` (and the ports in the URLs, `LANGFLOW_PUBLIC_URL` included), `API_PORT`, `WEB_PORT`, `LANGFLOW_PORT` or `KEYCLOAK_PORT` in `.env`. A Langflow already running on the host often holds 7860 |
| `rag.localhost` doesn't open | Some browsers and tools don't resolve `*.localhost`: add the `/etc/hosts` line from [Where everything is](#where-everything-is), or use the `localhost` ports |
| Documents stay `failed` with an embedding error | LM Studio isn't running, or the embedding model id doesn't match `DEFAULT_EMBEDDING_MODEL`. Fix it, then reindex the document |
| Answers fail with `502` or `504` | The chat model failed or timed out; check the System page (`GET /v1/system`) and LM Studio's log |
| `429 Too Many Requests` | A rate limit (600 requests, 30 model calls a minute per person or key). Wait for `Retry-After`, or raise `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_MODEL_PER_MINUTE` in `.env` |
| `503` on search right after a reindex | The workspace is `reindexing`; it answers again once every document is `ready` |
| A workspace-wide search misses passages that a search inside one folder finds | The workspace was created before the search-recall settings (2026-11-23). Reindex it once (`POST /v1/workspaces/{slug}/reindex`, no body) |
