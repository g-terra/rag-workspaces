import { z } from 'zod';

/**
 * Everything the API reads from the environment, validated once at startup.
 * A missing or malformed value stops the process with a readable message
 * instead of failing later in the middle of a request.
 */
/** Compose passes unset variables as empty strings; treat those as missing. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

/** `{"<embedding model id>": {"document": "…", "query": "…"}}`; a missing prefix is "". */
const prefixMap = z.preprocess(
  (v) => (v === '' || v === undefined ? {} : typeof v === 'string' ? JSON.parse(v) : v),
  z.record(
    z.string(),
    z.object({ document: z.string().default(''), query: z.string().default('') }).strict(),
  ),
);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The URL people use to reach the API; shown as the server in the OpenAPI spec. */
  PUBLIC_API_URL: z.url().default('http://localhost:3000'),
  /** How long `/ready` waits for each dependency before calling it down. */
  READY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  // --- Postgres ---
  /** The app database. Migrations run against it on every start. */
  DATABASE_URL: z.string().default('postgres://rag@postgres:5432/rag'),

  // --- Uploads ---
  /** The uploads volume, shared read-only with Langflow at the same path. */
  UPLOADS_DIR: z.string().default('/data/uploads'),
  /**
   * Largest accepted file, in bytes: 2 GB by default, so lecture videos fit. Compose passes the same value
   * to nginx in front of the admin UI (`client_max_body_size`).
   */
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 ** 3),
  /** Most files in one upload request. */
  MAX_UPLOAD_FILES: z.coerce.number().int().positive().default(20),

  // --- Defaults for new workspaces (each can override them) ---
  /** Pinned into a workspace when it is created; changing it later needs a reindex. */
  DEFAULT_EMBEDDING_PROVIDER: z.enum(['lmstudio', 'openai', 'gemini']).default('lmstudio'),
  DEFAULT_EMBEDDING_MODEL: z.string().default('text-embedding-nomic-embed-text-v1.5'),
  /**
   * Task prefixes per embedding model id, over the built-in ones (providers.ts): text put before each
   * document and each query before embedding. Pinned into a workspace with its model, so changing them
   * takes effect on the next reindex.
   */
  EMBEDDING_PREFIXES: prefixMap,

  /** Used by workspaces that do not pick their own chat model. */
  DEFAULT_CHAT_PROVIDER: z.enum(['lmstudio', 'openai', 'anthropic', 'gemini']).default('lmstudio'),
  DEFAULT_CHAT_MODEL: z.string().default('qwen2.5-7b-instruct'),

  DEFAULT_CHUNK_SIZE: z.coerce.number().int().positive().default(800),
  DEFAULT_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(100),
  /** Passages given to the model per answer, and the default `limit` of a passage search. */
  DEFAULT_TOP_K: z.coerce.number().int().min(1).max(50).default(5),
  /**
   * Cosine similarity a passage needs to count as relevant. Below it, a search leaves the
   * passage out and an answer says the workspace does not cover the question.
   */
  DEFAULT_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),
  /**
   * `reasoning_effort` sent to the chat model by workspaces that do not set their own, e.g. "none" to
   * stop Qwen 3 thinking before every answer. Unset: nothing is sent.
   */
  DEFAULT_REASONING_EFFORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  ),

  // --- Model providers (keys stay here, never in Langflow's environment) ---
  /** LM Studio's OpenAI-compatible server, as Langflow's container reaches it. */
  LMSTUDIO_BASE_URL: z.url().default('http://host.docker.internal:1234/v1'),
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,

  // --- Ingestion ---
  /** A flow run gets this long, plus INGEST_TIMEOUT_MS_PER_MB for each megabyte of the file. */
  /**
   * The Whisper ASR service (compose profile `video`), e.g. http://whisper:9000. Unset, video and audio
   * uploads are refused with 415.
   */
  WHISPER_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  INGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  INGEST_TIMEOUT_MS_PER_MB: z.coerce.number().int().nonnegative().default(60_000),
  /** Attempts per document before it is `failed` (1 + retries). */
  INGEST_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),

  // --- Asking ---
  /** A passage search (embedding the query plus one Chroma query) gets this long. */
  RETRIEVE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** A whole answer (search, prompt, generation) gets this long. Local models can be slow. */
  ANSWER_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /** Earlier turns (a question and its reply) sent to the model with each chat message. */
  CHAT_HISTORY_TURNS: z.coerce.number().int().min(0).max(50).default(10),
  /** Requests a person or API key may make per minute across `/v1`. 0 turns the limit off. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(600),
  /** Of those, the ones that run a model (search, answers, chat messages). 0 turns the limit off. */
  RATE_LIMIT_MODEL_PER_MINUTE: z.coerce.number().int().min(0).default(30),
  /** Question text in the usage log is cleared after this many days; counts and latency stay. */
  USAGE_QUESTION_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),

  // --- Langflow ---
  LANGFLOW_URL: z.url().default('http://langflow:7860'),
  /** The API signs in as this user on start to mint its own Langflow API key (decision 17). */
  LANGFLOW_SUPERUSER: z.string().default('admin'),
  LANGFLOW_SUPERUSER_PASSWORD: optionalString,
  /** Fallback when signing in fails: a key made by hand in the Langflow UI. */
  LANGFLOW_API_KEY: optionalString,

  // --- Chroma ---
  CHROMA_URL: z.url().default('http://chroma:8000'),

  // --- Keycloak ---
  /** Where the API reaches Keycloak inside the compose network (keys, health). Not the token issuer. */
  KEYCLOAK_INTERNAL_URL: z.url().default('http://keycloak:8080'),
  KEYCLOAK_REALM: z.string().default('rag-workspaces'),
  /** The URL browsers use for Keycloak. Tokens carry `<this>/realms/<realm>` as their issuer. */
  KEYCLOAK_PUBLIC_URL: z.url().default('http://localhost:8081'),
  /** Access tokens must name this audience (the `api` client in realm.json). */
  KEYCLOAK_AUDIENCE: z.string().default('api'),
  /** The confidential client the API reads the people list with (GET /v1/users). */
  KEYCLOAK_DIRECTORY_CLIENT_ID: z.string().default('api-directory'),
  /** Its secret, generated by `pnpm env:init` and imported into the realm. Without it /v1/users is 503. */
  KEYCLOAK_DIRECTORY_SECRET: optionalString,
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
