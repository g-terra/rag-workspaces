import { z } from 'zod';

/**
 * Everything the API reads from the environment, validated once at startup.
 * A missing or malformed value stops the process with a readable message
 * instead of failing later in the middle of a request.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The URL people use to reach the API; shown as the server in the OpenAPI spec. */
  PUBLIC_API_URL: z.url().default('http://localhost:3000'),
  /** How long `/ready` waits for each dependency before calling it down. */
  READY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
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
