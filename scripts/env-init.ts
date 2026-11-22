// Create .env from .env.example, replacing every <generated> value with a fresh secret.
// Never overwrites an existing .env.   Usage: pnpm env:init
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);

if (existsSync(target)) {
  console.log('.env already exists; leaving it alone.');
  process.exit(0);
}

const secret = (key: string): string =>
  key === 'LANGFLOW_SECRET_KEY'
    ? randomBytes(32).toString('base64url') + '=' // Fernet key: 32 bytes, url-safe base64, padded
    : randomBytes(18).toString('base64url');

const lines = readFileSync(new URL('.env.example', root), 'utf8')
  .split('\n')
  .map((line) => {
    const m = /^([A-Z0-9_]+)=<generated>$/.exec(line);
    return m ? `${m[1]}=${secret(m[1]!)}` : line;
  });

writeFileSync(target, lines.join('\n'), { mode: 0o600 });
console.log(
  'Wrote .env with fresh secrets. Your rag-workspaces login is RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD in it.',
);
