// Small helpers for `pnpm run setup` (scripts/setup.ts), kept apart so they can be tested.

/** `KEY=value` lines of a .env file. Comments and blank lines are skipped; values are kept as written. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

/**
 * Set values in a .env file's text: an existing line is changed where it is, so comments and order
 * stay; a key the file doesn't have yet is added at the end.
 */
export function setEnv(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = text.split('\n').map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });
  let out = lines.join('\n');
  if (pending.size) {
    const added = [...pending].map(([k, v]) => `${k}=${v}`).join('\n');
    out = `${out.replace(/\n*$/, '\n')}\n# Added by pnpm run setup\n${added}\n`;
  }
  return out;
}

/** LM Studio lists chat and embedding models together; embedding models say so in their id. */
export function splitModels(ids: string[]): { chat: string[]; embedding: string[] } {
  const isEmbedding = (id: string) => /embed/i.test(id);
  return { chat: ids.filter((id) => !isEmbedding(id)), embedding: ids.filter(isEmbedding) };
}

/** `.env` holds URLs as containers see them; from the host, `host.docker.internal` is `localhost`. */
export function hostUrl(url: string): string {
  return url.replace('//host.docker.internal', '//localhost');
}
