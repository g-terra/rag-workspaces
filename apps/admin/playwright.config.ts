import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real stack: nginx serving the built UI, the API and Keycloak.
// `pnpm e2e` from the repo root starts a throwaway stack and runs them on it. Against your own stack:
// start it first (`docker compose up -d --build`), then `pnpm --filter @rag/admin e2e`.
export default defineConfig({
  testDir: './e2e',
  // The tests share one Keycloak account and its session; run them one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
