// The throwaway stack the smoke test (and other suites) run against: the normal compose stack plus
// docker-compose.smoke.yml, as its own project on its own ports, so it never touches the dev stack.
//   node scripts/smoke/stack.ts up     create .env.smoke if missing, build, start and wait until healthy
//   node scripts/smoke/stack.ts down   remove the containers and their volumes
//   node scripts/smoke/stack.ts logs   print every service's state and recent logs
// Other scripts import `compose` and `smokeEnv` from here.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const envFile = new URL('.env.smoke', root);

const PROJECT = 'rag-workspaces-smoke';

// Host ports and the browser-facing URLs that go with them. Keycloak only reads ADMIN_UI_URL on the
// first start (realm import), which is fine: `down` removes the volumes every time.
const SMOKE_SETTINGS = {
  PROXY_PORT: '18088',
  API_PORT: '13000',
  WEB_PORT: '18080',
  KEYCLOAK_PORT: '18081',
  LANGFLOW_PORT: '17860',
  CHROMA_PORT: '18000',
  PUBLIC_API_URL: 'http://localhost:13000',
  ADMIN_UI_URL: 'http://localhost:18080',
  KEYCLOAK_PUBLIC_URL: 'http://localhost:18081',
  LANGFLOW_PUBLIC_URL: 'http://localhost:17860',
  DEFAULT_EMBEDDING_PROVIDER: 'lmstudio',
  DEFAULT_EMBEDDING_MODEL: 'standin-embed-a',
  // The stand-in has no prefixes of its own; these show they reach the model (check.ts).
  EMBEDDING_PREFIXES: `'{"standin-embed-a": {"document": "passage: ", "query": "query: "}}'`,
  STANDIN_PORT: '11234',
};

/** .env.example with fresh secrets (the same rule as scripts/env-init.ts), then the smoke settings. */
function writeEnvFile() {
  const secret = (key: string) =>
    key === 'LANGFLOW_SECRET_KEY'
      ? randomBytes(32).toString('base64url') + '='
      : randomBytes(18).toString('base64url');
  const lines = readFileSync(new URL('.env.example', root), 'utf8')
    .split('\n')
    .filter((line) => !(line.split('=')[0]! in SMOKE_SETTINGS))
    .map((line) => {
      const m = /^([A-Z0-9_]+)=<generated>$/.exec(line);
      return m ? `${m[1]}=${secret(m[1]!)}` : line;
    });
  lines.push('', '# --- Smoke stack (scripts/smoke/stack.ts) ---');
  for (const [k, v] of Object.entries(SMOKE_SETTINGS)) lines.push(`${k}=${v}`);
  writeFileSync(envFile, lines.join('\n') + '\n', { mode: 0o600 });
}

/** The values in .env.smoke, for the checks (admin login, ports). */
export function smokeEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter((m) => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
}

/**
 * Run `docker compose` against the smoke project. Throws on a non-zero exit unless `allowFail`.
 * `capture` returns stdout instead of printing it. Errors name only the subcommand, never the
 * arguments, so nothing passed to it can end up in a CI log.
 */
export function compose(args: string[], opts: { allowFail?: boolean; capture?: boolean } = {}) {
  const res = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      PROJECT,
      '--project-directory',
      fileURLToPath(root),
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.smoke.yml',
      '--env-file',
      '.env.smoke',
      ...args,
    ],
    {
      cwd: root,
      stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
    },
  );
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`docker compose ${args[0]} exited with ${res.status}`);
  }
  return { status: res.status ?? 1, stdout: res.stdout ?? '' };
}

/** True when the smoke project has containers (running or not). */
function stackExists() {
  return (
    existsSync(envFile) &&
    compose(['ps', '--all', '--quiet'], { capture: true, allowFail: true }).stdout.trim() !== ''
  );
}

export function up() {
  // A fresh file for every new stack, so it always matches the current .env.example. A running stack
  // keeps its file: its databases were created with those passwords.
  if (!stackExists()) {
    writeEnvFile();
    console.log('Wrote .env.smoke (admin login: RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD in it).');
  }
  compose(['up', '--detach', '--build', '--wait', '--wait-timeout', '600']);
  const env = smokeEnv();
  console.log(
    `Smoke stack up: API ${env.PUBLIC_API_URL}, admin UI ${env.ADMIN_UI_URL}, Keycloak ${env.KEYCLOAK_PUBLIC_URL}`,
  );
}

export function down() {
  if (!existsSync(envFile)) writeEnvFile(); // compose needs the variables even to tear down
  compose(['down', '--volumes', '--remove-orphans'], { allowFail: true });
}

/** What every service is doing, and its recent logs: printed when something fails. */
export function logs() {
  compose(['ps', '--all'], { allowFail: true });
  compose(['logs', '--no-color', '--tail', '200'], { allowFail: true });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'up') up();
  else if (command === 'down') down();
  else if (command === 'logs') logs();
  else {
    console.error('Usage: node scripts/smoke/stack.ts up|down|logs');
    process.exit(2);
  }
}
