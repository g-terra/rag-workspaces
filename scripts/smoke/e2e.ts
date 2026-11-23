// `pnpm e2e`: start the smoke stack, run the admin UI's Playwright tests against it, tear it down
// (also when a test fails). Extra arguments go to Playwright.
//   pnpm e2e                    up, test, down
//   pnpm e2e --keep             leave the stack running afterwards
//   pnpm e2e upload.spec.ts     run one spec file
// Needs Docker and Playwright's Chromium (`pnpm --filter @rag/admin exec playwright install chromium`).
import { spawnSync } from 'node:child_process';
import { down, logs, smokeEnv, up } from './stack.ts';

const keep = process.argv.includes('--keep');
const playwrightArgs = process.argv.slice(2).filter((a) => a !== '--keep' && a !== '--');
let status = 1;
try {
  up();
  const env = smokeEnv();
  status =
    spawnSync('pnpm', ['--filter', '@rag/admin', 'e2e', ...playwrightArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BASE_URL: env.ADMIN_UI_URL,
        E2E_USERNAME: env.RW_ADMIN_USERNAME,
        E2E_PASSWORD: env.RW_ADMIN_PASSWORD,
      },
    }).status ?? 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
}
if (status !== 0) logs();
if (keep) console.log('Stack left running (--keep). Remove it with: node scripts/smoke/stack.ts down');
else down();
process.exit(status);
