import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real stack: nginx serving the built UI, the API and Keycloak.
// Start it first (`docker compose up -d --build` from the repo root), then `pnpm --filter @rag/admin e2e`.
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
