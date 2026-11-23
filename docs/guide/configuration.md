# Configuration reference

Everything the stack reads from `.env`. `pnpm env:init` (or `pnpm run setup`) writes it from
`.env.example` with fresh random values for every secret, and only ever adds missing values to an
existing file. After changing a value, run `docker compose up -d` so the containers pick it up.

`.env` holds passwords and keys. It is ignored by Git; never commit or share it.

Most behaviour is set per workspace in the admin UI ([Workspaces](workspaces.md#settings-admins)); the
values here are the defaults for workspaces that don't set their own, plus how the stack itself runs.

## Models

| Variable | Default | Meaning |
|---|---|---|
| `DEFAULT_CHAT_PROVIDER` | `lmstudio` | Chat provider for workspaces without their own: `lmstudio`, `openai`, `anthropic` or `gemini` |
| `DEFAULT_CHAT_MODEL` | `openai/gpt-oss-20b` | Chat model id, exactly as the provider names it |
| `DEFAULT_EMBEDDING_PROVIDER` | `lmstudio` | Embedding provider pinned into each new workspace: `lmstudio`, `openai` or `gemini` |
| `DEFAULT_EMBEDDING_MODEL` | `text-embedding-nomic-embed-text-v1.5` | Embedding model pinned into each new workspace. Changing it affects only new workspaces |
| `EMBEDDING_PREFIXES` | empty | Extra text put before documents and queries, per embedding model, as one line of JSON: `'{"my-model": {"document": "passage: ", "query": "query: "}}'`. nomic and Qwen3-Embedding are built in. Applies at creation or reindex |
| `DEFAULT_MIN_SCORE` | `0.3` | Relevance threshold (0 to 1) a passage needs to count |
| `DEFAULT_REASONING_EFFORT` | empty | `none`, `minimal`, `low`, `medium` or `high`, sent to LM Studio and OpenAI. Empty sends nothing |
| `CHAT_HISTORY_TURNS` | `10` | Earlier turns of a conversation sent with each new message |
| `LMSTUDIO_BASE_URL` | `http://host.docker.internal:1234/v1` | Where the containers reach LM Studio |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | empty | Hosted provider keys for every workspace. A key saved in a workspace's settings wins for that workspace |
| `SECRETS_KEY` | generated | Encrypts provider keys saved in the admin UI. Changing it makes them unreadable |

See [Models and providers](providers.md).

## Sign-in and addresses

| Variable | Default | Meaning |
|---|---|---|
| `RW_ADMIN_USERNAME`, `RW_ADMIN_EMAIL`, `RW_ADMIN_PASSWORD` | `admin`, `admin@example.com`, generated | The first rag-workspaces admin, created on the first start |
| `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | `admin`, generated | Keycloak's own admin console, where you create people |
| `KEYCLOAK_DIRECTORY_SECRET` | generated | The read-only service account the API lists people with |
| `KEYCLOAK_PUBLIC_URL` | `http://auth.rag.localhost` | Keycloak as the browser sees it; tokens carry it as their issuer |
| `ADMIN_UI_URL` | `http://rag.localhost` | The admin UI as the browser sees it |
| `PUBLIC_API_URL` | `http://api.rag.localhost` | The API as callers see it; shown in Swagger |
| `LANGFLOW_PUBLIC_URL` | `http://langflow.rag.localhost` | The Langflow editor, linked from the System page. Built into the admin UI: run `docker compose up -d --build` after changing it |

To skip the local names, use `http://localhost:8081`, `:8080` and `:3000`. On an existing install the
Keycloak realm needs a matching change by hand ([README](../../README.md#updating-an-existing-install)).

## Ports

All published on `127.0.0.1` only.

| Variable | Default | Service |
|---|---|---|
| `PROXY_PORT` | `80` | The proxy behind `rag.localhost` and the other names. If you change it, add the port to the four URLs above |
| `API_PORT` | `3000` | API and Swagger UI |
| `WEB_PORT` | `8080` | Admin UI |
| `LANGFLOW_PORT` | `7860` | Langflow editor |
| `KEYCLOAK_PORT` | `8081` | Keycloak |

## Limits

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | `600` | Requests a minute per person or API key, across `/v1`. `0` turns it off |
| `RATE_LIMIT_MODEL_PER_MINUTE` | `30` | Of those, requests that run a model (search, answers, chat). `0` turns it off |
| `MAX_UPLOAD_BYTES` | `2147483648` (2 GB) | Largest file in one upload, for the API and the admin UI |
| `USAGE_QUESTION_RETENTION_DAYS` | `90` | Question text is cleared from the usage log after this; counts stay |

Over a rate limit the API answers `429` with `Retry-After`.

## Video and audio

| Variable | Default | Meaning |
|---|---|---|
| `COMPOSE_PROFILES` | unset | `video` starts the Whisper service |
| `WHISPER_URL` | unset | `http://whisper:9000` to transcribe MP4, MP3 and WAV uploads |
| `WHISPER_MODEL` | `base` | `tiny`, `base`, `small`, `medium` or `large-v3`: bigger is slower and more accurate |

## Internals

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | `rag`, `rag`, generated | The Postgres that holds the app's, Langflow's and Keycloak's databases |
| `LANGFLOW_SUPERUSER`, `LANGFLOW_SUPERUSER_PASSWORD` | `admin`, generated | Langflow's login. The API signs in with it on start and makes its own Langflow key |
| `LANGFLOW_SECRET_KEY` | generated | Langflow's encryption key (a Fernet key) |
| `LANGFLOW_API_KEY` | empty | Fallback: a key made by hand in Langflow, used only if the API can't sign in to make its own |
| `LOG_LEVEL` | `info` | The API's log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

Never add provider keys to Langflow's own environment; the API passes them with each run.
