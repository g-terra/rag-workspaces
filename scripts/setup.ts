// `pnpm run setup`: take a fresh clone (or a broken install) to a running stack.
// It checks the machine, writes .env, helps pick the model provider and models, starts compose,
// waits for the API, and prints where to sign in. Safe to run again: it keeps every secret and
// offers the current values as the defaults.
//   pnpm run setup          ask
//   pnpm run setup --yes    take the current values or the defaults, ask nothing (scripts, CI)
// (`pnpm setup` without `run` is pnpm's own command, which sets up pnpm itself.)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { createInterface, type Interface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { hostUrl, parseEnv, setEnv, splitModels } from './setup/env-file.ts';
import { portFree } from './setup/ports.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = `${root}.env`;
const yes = process.argv.includes('--yes') || !process.stdin.isTTY;

const say = (text = '') => console.log(text);
const ok = (text: string) => say(`  ✓ ${text}`);
const warn = (text: string) => say(`  ! ${text}`);
function fail(text: string): never {
  say(`  ✗ ${text}`);
  process.exit(1);
}

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
  });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() };
}

// ---- prompts ----

let rl: Interface | undefined;
const prompt = () => (rl ??= createInterface({ input: process.stdin, output: process.stdout }));

async function ask(question: string, fallback: string): Promise<string> {
  if (yes) return fallback;
  const answer = (await prompt().question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer || fallback;
}

/** A numbered list; returns the chosen entry. */
async function choose(question: string, options: string[], fallback: string): Promise<string> {
  if (yes) return fallback;
  options.forEach((o, i) => say(`    ${i + 1}. ${o}`));
  for (;;) {
    const answer = await ask(question, fallback);
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!;
    if (options.includes(answer)) return answer;
    warn(`Pick a number from 1 to ${options.length}.`);
  }
}

/** Typed without echo, for API keys. An empty answer keeps the current value. */
async function askSecret(question: string, current: string): Promise<string> {
  if (yes) return current;
  // A second interface whose output goes nowhere, so the key is not echoed; ours prints the label.
  rl?.close();
  rl = undefined;
  process.stdout.write(`  ${question}${current ? ' [Enter keeps the current one]' : ''}: `);
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  const hidden = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return (await hidden.question('')).trim() || current;
  } finally {
    hidden.close();
    process.stdout.write('\n');
  }
}

// ---- 1. the machine ----

function checkTools() {
  say('Checking the tools');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18))
    fail(`Node ${process.versions.node}: 22.18 or newer is needed.`);
  ok(`Node ${process.versions.node}`);
  const docker = run('docker', ['version', '--format', '{{.Server.Version}}'], { quiet: true });
  if (!docker.ok)
    fail(
      `Docker isn't running (${docker.err.split('\n')[0] || 'docker not found'}). Start Docker and try again.`,
    );
  ok(`Docker ${docker.out}`);
  const compose = run('docker', ['compose', 'version', '--short'], { quiet: true });
  if (!compose.ok) fail('Docker Compose v2 is needed (`docker compose`).');
  ok(`Docker Compose ${compose.out}`);
}

/** The program listening on a port, from lsof (macOS and most Linux), or null. */
function holder(port: number): string | null {
  const res = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fcp'], { quiet: true });
  const name = /^c(.+)$/m.exec(res.out)?.[1];
  const pid = /^p(\d+)$/m.exec(res.out)?.[1];
  return name ? `${name}${pid ? ` (pid ${pid})` : ''}` : null;
}

async function checkPorts(env: Record<string, string>) {
  say('Checking the ports');
  const running = run('docker', ['compose', 'ps', '--status', 'running', '-q'], { quiet: true });
  if (running.ok && running.out) {
    ok('The stack is already running; it will be updated in place.');
    return;
  }
  const ports: [string, string][] = [
    ['PROXY_PORT', '80'],
    ['API_PORT', '3000'],
    ['WEB_PORT', '8080'],
    ['LANGFLOW_PORT', '7860'],
    ['KEYCLOAK_PORT', '8081'],
  ];
  const taken: string[] = [];
  for (const [key, fallback] of ports) {
    const port = Number(env[key] || fallback);
    if (await portFree(port)) continue;
    const who = holder(port);
    taken.push(`${port} (${key})${who ? ` is used by ${who}` : ' is in use'}`);
  }
  if (taken.length) {
    for (const t of taken) warn(t);
    fail(
      'Stop what holds those ports, or set other ports in .env (README, "Run the stack"), then run this again.',
    );
  }
  ok('Ports free');
}

// ---- 2. .env ----

function writeSecrets() {
  say('Writing .env');
  const res = run(process.execPath, [`${root}scripts/env-init.ts`], { quiet: true });
  if (!res.ok) fail(`pnpm env:init failed: ${res.err}`);
  ok(res.out);
}

// ---- 3. models ----

type Provider = 'lmstudio' | 'openai' | 'gemini' | 'anthropic';
const KEY_OF: Record<Exclude<Provider, 'lmstudio'>, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
const SUGGESTED: Record<Provider, { chat?: string; embedding?: string }> = {
  lmstudio: { chat: 'qwen2.5-7b-instruct', embedding: 'text-embedding-nomic-embed-text-v1.5' },
  openai: { chat: 'gpt-4o-mini', embedding: 'text-embedding-3-small' },
  gemini: { chat: 'gemini-2.0-flash', embedding: 'text-embedding-004' },
  anthropic: { chat: 'claude-haiku-4-5' },
};

/** The models a provider offers now, or why it couldn't be asked (the same calls as GET /v1/system). */
async function listModels(provider: Provider, env: Record<string, string>): Promise<string[] | string> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id.replace(/^models\//, ''));
  };
  try {
    switch (provider) {
      case 'lmstudio':
        return await get(`${hostUrl(env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1')}/models`, {});
      case 'openai':
        return await get('https://api.openai.com/v1/models', {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        });
      case 'gemini':
        return await get('https://generativelanguage.googleapis.com/v1beta/openai/models', {
          authorization: `Bearer ${env.GEMINI_API_KEY}`,
        });
      case 'anthropic':
        return await get('https://api.anthropic.com/v1/models?limit=1000', {
          'x-api-key': env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        });
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Make sure the provider can be reached (asking for its key if needed); returns its models, or []. */
async function reach(provider: Provider, env: Record<string, string>, changes: Record<string, string>) {
  if (provider !== 'lmstudio') {
    const key = KEY_OF[provider];
    const value = await askSecret(`${key}`, env[key] ?? '');
    if (!value) fail(`${key} is needed for ${provider}. Set it in .env or run this again.`);
    if (value !== env[key]) changes[key] = env[key] = value;
  }
  const models = await listModels(provider, env);
  if (typeof models === 'string') {
    if (provider === 'lmstudio')
      warn(`LM Studio didn't answer (${models}). Start its server (port 1234) with the models loaded.`);
    else warn(`${provider} refused the key or couldn't be reached (${models}).`);
    return [];
  }
  ok(`${provider} answers, with ${models.length} model(s)`);
  return models;
}

async function pickModel(kind: 'chat' | 'embedding', provider: Provider, models: string[], current: string) {
  const fallback = current || SUGGESTED[provider][kind] || '';
  const offered = provider === 'lmstudio' ? splitModels(models)[kind] : [];
  const chosen = offered.length
    ? await choose(
        `${kind === 'chat' ? 'Chat' : 'Embedding'} model`,
        offered,
        offered.includes(fallback) ? fallback : offered[0]!,
      )
    : await ask(`${kind === 'chat' ? 'Chat' : 'Embedding'} model id`, fallback);
  if (models.length && !models.includes(chosen))
    warn(`${chosen} isn't among the models ${provider} offers now.`);
  return chosen;
}

async function chooseModels(env: Record<string, string>): Promise<Record<string, string>> {
  say('Choosing the models');
  const changes: Record<string, string> = {};
  const providers: Provider[] = ['lmstudio', 'openai', 'gemini', 'anthropic'];
  const chatProvider = (await choose(
    'Chat provider (lmstudio runs on this machine, offline)',
    providers,
    env.DEFAULT_CHAT_PROVIDER || 'lmstudio',
  )) as Provider;
  const chatModels = await reach(chatProvider, env, changes);
  const chatModel = await pickModel(
    'chat',
    chatProvider,
    chatModels,
    chatProvider === env.DEFAULT_CHAT_PROVIDER ? (env.DEFAULT_CHAT_MODEL ?? '') : '',
  );

  // Anthropic has no embedding models.
  const embeddingProviders = providers.filter((p) => p !== 'anthropic');
  const embeddingDefault =
    env.DEFAULT_EMBEDDING_PROVIDER || (chatProvider === 'anthropic' ? 'lmstudio' : chatProvider);
  const embeddingProvider = (await choose(
    'Embedding provider (each new workspace keeps the one chosen now)',
    embeddingProviders,
    embeddingDefault,
  )) as Provider;
  const embeddingModels =
    embeddingProvider === chatProvider ? chatModels : await reach(embeddingProvider, env, changes);
  const embeddingModel = await pickModel(
    'embedding',
    embeddingProvider,
    embeddingModels,
    embeddingProvider === env.DEFAULT_EMBEDDING_PROVIDER ? (env.DEFAULT_EMBEDDING_MODEL ?? '') : '',
  );

  const wanted = {
    DEFAULT_CHAT_PROVIDER: chatProvider,
    DEFAULT_CHAT_MODEL: chatModel,
    DEFAULT_EMBEDDING_PROVIDER: embeddingProvider,
    DEFAULT_EMBEDDING_MODEL: embeddingModel,
  };
  for (const [k, v] of Object.entries(wanted)) if (env[k] !== v) changes[k] = v;
  ok(`Chat: ${chatProvider} ${chatModel}. Embeddings: ${embeddingProvider} ${embeddingModel}.`);
  return changes;
}

// ---- 4. start ----

async function start(env: Record<string, string>) {
  say('Starting the stack (the first start pulls about 2 GB of images and takes a few minutes)');
  if (!run('docker', ['compose', 'up', '--detach', '--build', '--wait', '--wait-timeout', '900']).ok) {
    fail('docker compose up failed. `docker compose ps` and `docker compose logs <service>` say why.');
  }
  const ready = `http://localhost:${env.API_PORT || '3000'}/ready`;
  const deadline = Date.now() + 300_000;
  for (;;) {
    const res = await fetch(ready).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > deadline)
      fail(`The API isn't ready after 5 minutes: ${ready}. Try \`docker compose logs api\`.`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  ok('The API is ready');
}

// ---- main ----

say(yes ? 'rag-workspaces setup (taking the defaults)\n' : 'rag-workspaces setup\n');
checkTools();
await checkPorts(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {});
writeSecrets();
const env = parseEnv(readFileSync(envPath, 'utf8'));
const changes = await chooseModels(env);
rl?.close();
if (Object.keys(changes).length) {
  writeFileSync(envPath, setEnv(readFileSync(envPath, 'utf8'), changes), { mode: 0o600 });
  ok(`Updated .env: ${Object.keys(changes).join(', ')}`);
}
await start(env);

const url = (key: string, fallback: string) => env[key] || fallback;
say(`
Done. Sign in to the admin UI as ${env.RW_ADMIN_USERNAME} (password: RW_ADMIN_PASSWORD in .env).

  Admin UI           ${url('ADMIN_UI_URL', 'http://rag.localhost')}
  API and Swagger    ${url('PUBLIC_API_URL', 'http://api.rag.localhost')}/docs
  Keycloak console   ${url('KEYCLOAK_PUBLIC_URL', 'http://auth.rag.localhost')}/admin  (KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD)

Next: create a workspace in the admin UI and upload some files. docs/setup.md explains the rest.`);
