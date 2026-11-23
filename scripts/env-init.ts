// Create .env from .env.example, replacing every <generated> value with a fresh secret.
// Safe to run again: an existing .env keeps every value it has, and only secrets that
// .env.example has gained since (a new <generated> line) are added at the end.
//   Usage: pnpm env:init
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);

const secret = (key: string): string =>
  key === 'LANGFLOW_SECRET_KEY'
    ? randomBytes(32).toString('base64url') + '=' // Fernet key: 32 bytes, url-safe base64, padded
    : randomBytes(18).toString('base64url');

const example = readFileSync(new URL('.env.example', root), 'utf8').split('\n');
const generated = (line: string) => /^([A-Z0-9_]+)=<generated>$/.exec(line)?.[1];

if (!existsSync(target)) {
  const lines = example.map((line) => {
    const key = generated(line);
    return key ? `${key}=${secret(key)}` : line;
  });
  writeFileSync(target, lines.join('\n'), { mode: 0o600 });
  console.log(
    'Wrote .env with fresh secrets. Your rag-workspaces login is RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD in it.',
  );
  process.exit(0);
}

const current = readFileSync(target, 'utf8');
const present = new Set(current.split('\n').map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1]));
const missing = example.map(generated).filter((key): key is string => !!key && !present.has(key));
if (missing.length === 0) {
  console.log('.env already has every secret; leaving it alone.');
  process.exit(0);
}
const added = missing.map((key) => `${key}=${secret(key)}`).join('\n');
writeFileSync(target, `${current.replace(/\n*$/, '\n')}\n# Added by pnpm env:init\n${added}\n`, {
  mode: 0o600,
});
console.log(`Added to .env: ${missing.join(', ')}. Everything already there is unchanged.`);
