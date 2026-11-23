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
 * stay. A key that is only there commented out (`# KEY=example`, as in .env.example) is uncommented in
 * place. A key the file doesn't have at all is added at the end.
 */
export function setEnv(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const live = new Set(Object.keys(parseEnv(text)));
  const lines = text.split('\n').map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    const commented = /^# ?([A-Z0-9_]+)=/.exec(line)?.[1];
    const target = key ?? (commented && !live.has(commented) ? commented : undefined);
    if (!target || !pending.has(target)) return line;
    const value = pending.get(target)!;
    pending.delete(target);
    return `${target}=${value}`;
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
