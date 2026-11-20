import { z } from 'zod';

/**
 * Everything the API reads from the environment, validated once at startup.
 * A missing or malformed value stops the process with a readable message
 * instead of failing later in the middle of a request.
 */
/** Compose passes unset variables as empty strings; treat those as missing. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

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
