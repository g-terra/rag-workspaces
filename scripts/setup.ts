// `pnpm run setup`: take a fresh clone (or a broken install) to a running stack.
// It checks the machine, writes .env, helps pick the model provider and models, starts compose,
// waits for the API, and prints where to sign in. Safe to run again: it keeps every secret and
// offers the current values as the defaults.
//   pnpm run setup          interactive wizard (arrow-key selection)
//   pnpm run setup --yes    take the current values or the defaults, ask nothing (scripts, CI)
// (`pnpm setup` without `run` is pnpm's own command, which sets up pnpm itself.)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import {
  CUSTOM_MODEL,
  modelIdError,
  modelOptions,
  providerOptions,
  transcriptionEnv,
  whisperModelOptions,
  type ModelKind,
  type Provider,
  type WhisperModel,
} from './setup/choices.ts';
import { hostUrl, parseEnv, setEnv } from './setup/env-file.ts';
import { portFree } from './setup/ports.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = `${root}.env`;
const yes = process.argv.includes('--yes') || !process.stdin.isTTY;

function abort(): never {
  p.cancel('Setup cancelled.');
  process.exit(0);
}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) abort();
  return value as Exclude<T, symbol>;
}

function fail(text: string): never {
  p.log.error(text);
  p.outro('Setup stopped.');
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

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  if (yes) return task();
  const s = p.spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (err) {
    s.stop(message);
    throw err;
  }
}

// ---- 1. the machine ----

function checkTools() {
  p.log.step('Checking the tools');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    fail(`Node ${process.versions.node}: 22.18 or newer is needed.`);
  }
  const docker = run('docker', ['version', '--format', '{{.Server.Version}}'], { quiet: true });
  if (!docker.ok) {
    fail(
      `Docker isn't running (${docker.err.split('\n')[0] || 'docker not found'}). Start Docker and try again.`,
    );
  }
  const compose = run('docker', ['compose', 'version', '--short'], { quiet: true });
  if (!compose.ok) fail('Docker Compose v2 is needed (`docker compose`).');
  p.log.success(`Node ${process.versions.node} · Docker ${docker.out} · Compose ${compose.out}`);
}

/** The program listening on a port, from lsof (macOS and most Linux), or null. */
function holder(port: number): string | null {
  const res = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fcp'], { quiet: true });
  const name = /^c(.+)$/m.exec(res.out)?.[1];
  const pid = /^p(\d+)$/m.exec(res.out)?.[1];
  return name ? `${name}${pid ? ` (pid ${pid})` : ''}` : null;
}

async function checkPorts(env: Record<string, string>) {
  p.log.step('Checking the ports');
  const running = run('docker', ['compose', 'ps', '--status', 'running', '-q'], { quiet: true });
  if (running.ok && running.out) {
    p.log.success('The stack is already running; it will be updated in place.');
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
    for (const t of taken) p.log.warn(t);
    fail(
      'Stop what holds those ports, or set other ports in .env (README, "Run the stack"), then run this again.',
    );
  }
  p.log.success('All required ports are free');
}

// ---- 2. .env ----

function writeSecrets() {
  p.log.step('Preparing .env');
  const res = run(process.execPath, [`${root}scripts/env-init.ts`], { quiet: true });
  if (!res.ok) fail(`pnpm env:init failed: ${res.err}`);
  p.log.success(res.out);
}

// ---- 3. models ----

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

async function promptProvider(kind: ModelKind, initialValue: Provider): Promise<Provider> {
  if (yes) return initialValue;
  return unwrap(
    await p.select({
      message:
        kind === 'chat'
          ? 'Choose the default chat provider'
          : 'Choose the default embedding provider (pinned per workspace)',
      options: providerOptions(kind),
      initialValue,
    }),
  );
}

/** Make sure the provider can be reached (asking for its key if needed); returns its models, or []. */
async function reach(provider: Provider, env: Record<string, string>, changes: Record<string, string>) {
  if (provider !== 'lmstudio') {
    const key = KEY_OF[provider];
    const current = env[key] ?? '';
    let value = current;
    if (!yes) {
      const entered = unwrap(
        await p.password({
          message: current ? `${key} (press Enter to keep the current key)` : `Enter ${key}`,
          validate: (v) => (!current && !v?.trim() ? `${key} is required for ${provider}.` : undefined),
        }),
      ).trim();
      value = entered || current;
    }
    if (!value) fail(`${key} is needed for ${provider}. Set it in .env or run this again.`);
    if (value !== current) changes[key] = env[key] = value;
  }

  const models = await withSpinner(`Checking ${provider} models…`, () => listModels(provider, env));
  if (typeof models === 'string') {
    if (provider === 'lmstudio') {
      p.log.warn(`LM Studio didn't answer (${models}). Start its server (port 1234) with the models loaded.`);
    } else {
      p.log.warn(`${provider} refused the key or couldn't be reached (${models}).`);
    }
    return [];
  }
  p.log.success(`${provider} answered with ${models.length} model(s)`);
  return models;
}

async function pickModel(
  kind: ModelKind,
  provider: Provider,
  models: string[],
  current: string,
): Promise<string> {
  const suggested = SUGGESTED[provider][kind];
  const fallback = current || suggested || '';
  const built = modelOptions(kind, provider, models, current, suggested);

  if (yes) return fallback || built?.initialValue || '';

  const label = kind === 'chat' ? 'Chat model' : 'Embedding model';
  let chosen: string;

  if (built) {
    // Use searchable autocomplete for large lists (e.g. OpenAI/Gemini), plain arrow-key select for small ones.
    const selected =
      built.options.length > 10
        ? unwrap(
            await p.autocomplete({
              message: `${label} (${provider})`,
              options: built.options,
              initialValue: built.initialValue,
              placeholder: 'Type to filter, arrow keys to select…',
              maxItems: 10,
            }),
          )
        : unwrap(
            await p.select({
              message: `${label} (${provider})`,
              options: built.options,
              initialValue: built.initialValue,
              maxItems: 10,
            }),
          );

    if (selected === CUSTOM_MODEL) {
      chosen = unwrap(
        await p.text({
          message: `Enter ${label.toLowerCase()} id`,
          placeholder: fallback || 'model-id',
          defaultValue: fallback,
          validate: (v) => modelIdError(v, fallback),
        }),
      ).trim();
    } else {
      chosen = selected;
    }
  } else {
    chosen = unwrap(
      await p.text({
        message: `${label} id (${provider})`,
        placeholder: fallback || 'model-id',
        defaultValue: fallback,
        validate: (v) => modelIdError(v, fallback),
      }),
    ).trim();
  }

  if (models.length && !models.includes(chosen)) {
    p.log.warn(`${chosen} isn't among the models ${provider} offers now.`);
  }
  return chosen;
}

async function chooseModels(env: Record<string, string>): Promise<Record<string, string>> {
  p.log.step('Choosing the models');
  const changes: Record<string, string> = {};

  const chatDefault = (env.DEFAULT_CHAT_PROVIDER || 'lmstudio') as Provider;
  const chatProvider = await promptProvider('chat', chatDefault);
  const chatModels = await reach(chatProvider, env, changes);
  const chatModel = await pickModel(
    'chat',
    chatProvider,
    chatModels,
    chatProvider === env.DEFAULT_CHAT_PROVIDER ? (env.DEFAULT_CHAT_MODEL ?? '') : '',
  );

  const embeddingDefault = (env.DEFAULT_EMBEDDING_PROVIDER ||
    (chatProvider === 'anthropic' ? 'lmstudio' : chatProvider)) as Provider;
  const embeddingProvider = await promptProvider('embedding', embeddingDefault);
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
  for (const [k, v] of Object.entries(wanted)) {
    if (env[k] !== v) changes[k] = v;
  }
  p.note(
    `Chat:       ${chatProvider} / ${chatModel}\nEmbeddings: ${embeddingProvider} / ${embeddingModel}`,
    'Selected models',
  );
  return changes;
}

// ---- 4. video and audio ----

/** Whether to run Whisper for MP4, MP3 and WAV uploads, and which model; returns the .env changes. */
async function chooseTranscription(env: Record<string, string>): Promise<Record<string, string>> {
  if (yes) return {};
  p.log.step('Video and audio');
  p.note(
    [
      'Whisper turns MP4, MP3 and WAV uploads into timed transcripts, so lectures become searchable.',
      'It adds the whisper container (an image of about 1 GB) plus the model you pick, which is',
      'downloaded once when the stack starts, so the first upload does not wait for it.',
      'It runs on the CPU: with "base", an hour of lecture takes very roughly 5 to 15 minutes.',
    ].join('\n'),
    'Transcription (optional)',
  );
  const on = unwrap(
    await p.confirm({
      message: 'Transcribe video and audio uploads with Whisper?',
      initialValue: Boolean(env.WHISPER_URL),
    }),
  );
  let model = env.WHISPER_MODEL || 'base';
  if (on) {
    const options = whisperModelOptions();
    model = unwrap(
      await p.select<WhisperModel>({
        message: 'Whisper model (bigger is more accurate and slower)',
        options,
        initialValue: (options.find((o) => o.value === model)?.value ?? 'base') as WhisperModel,
      }),
    );
  }
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(transcriptionEnv(on, model, env.COMPOSE_PROFILES ?? ''))) {
    if ((env[k] ?? '') !== v) changes[k] = env[k] = v;
  }
  return changes;
}

// ---- 5. start ----

async function start(env: Record<string, string>) {
  if (!yes) {
    const proceed = unwrap(
      await p.confirm({
        message: 'Start or update the Docker stack now?',
        initialValue: true,
      }),
    );
    if (!proceed) {
      p.outro('Saved .env. Run `docker compose up -d --build` whenever you are ready.');
      process.exit(0);
    }
  }

  p.log.step(
    env.WHISPER_URL
      ? `Starting the stack (first start pulls ~3 GB of images and the Whisper ${env.WHISPER_MODEL || 'base'} model, and may take a while)`
      : 'Starting the stack (first start pulls ~2 GB of images and may take a few minutes)',
  );
  if (!run('docker', ['compose', 'up', '--detach', '--build', '--wait', '--wait-timeout', '900']).ok) {
    fail('docker compose up failed. `docker compose ps` and `docker compose logs <service>` say why.');
  }

  const ready = `http://localhost:${env.API_PORT || '3000'}/ready`;
  await withSpinner(`Waiting for the API at ${ready}…`, async () => {
    const deadline = Date.now() + 300_000;
    for (;;) {
      const res = await fetch(ready).catch(() => null);
      if (res?.ok) return;
      if (Date.now() > deadline) {
        fail(`The API isn't ready after 5 minutes: ${ready}. Try \`docker compose logs api\`.`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  });
  p.log.success('The API is ready');
}

// ---- main ----

p.intro(yes ? 'rag-workspaces setup (taking defaults)' : 'rag-workspaces setup');
checkTools();
await checkPorts(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {});
writeSecrets();
const env = parseEnv(readFileSync(envPath, 'utf8'));
const changes = { ...(await chooseModels(env)), ...(await chooseTranscription(env)) };
if (Object.keys(changes).length) {
  writeFileSync(envPath, setEnv(readFileSync(envPath, 'utf8'), changes), { mode: 0o600 });
  p.log.success(`Updated .env: ${Object.keys(changes).join(', ')}`);
}
await start(env);

const url = (key: string, fallback: string) => env[key] || fallback;
p.note(
  [
    `Admin UI           ${url('ADMIN_UI_URL', 'http://rag.localhost')}`,
    `API and Swagger    ${url('PUBLIC_API_URL', 'http://api.rag.localhost')}/docs`,
    `Langflow editor    http://langflow.rag.localhost`,
    `Keycloak console   ${url('KEYCLOAK_PUBLIC_URL', 'http://auth.rag.localhost')}/admin`,
    '',
    `Admin sign-in      ${env.RW_ADMIN_USERNAME} (password: RW_ADMIN_PASSWORD in .env)`,
  ].join('\n'),
  'Ready to use',
);
p.outro('Create a workspace in the admin UI and upload some files. See docs/setup.md for more.');
