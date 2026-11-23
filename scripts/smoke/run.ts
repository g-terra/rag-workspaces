// `pnpm smoke`: start the smoke stack, run the checks, tear it down (also when a check fails).
//   pnpm smoke           up, check, down
//   pnpm smoke --keep    leave the stack running afterwards (remove it with `node scripts/smoke/stack.ts down`)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { down, logs, up } from './stack.ts';

const keep = process.argv.includes('--keep');
let status = 1;
try {
  up();
  const check = fileURLToPath(new URL('check.ts', import.meta.url));
  status = spawnSync(process.execPath, [check], { stdio: 'inherit' }).status ?? 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
}
if (status !== 0) logs();
if (keep) console.log('Stack left running (--keep). Remove it with: node scripts/smoke/stack.ts down');
else down();
process.exit(status);
