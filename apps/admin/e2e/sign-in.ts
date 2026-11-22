import { test, type Page } from '@playwright/test';

// The seeded admin from .env (RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD), unless E2E_* say otherwise.
const username = process.env.E2E_USERNAME ?? process.env.RW_ADMIN_USERNAME ?? 'admin';
const password = process.env.E2E_PASSWORD ?? process.env.RW_ADMIN_PASSWORD;

/** Call at the top of a spec file: fails early when the admin password isn't set. */
export function requireCredentials() {
  test.beforeAll(() => {
    if (!password) throw new Error('Set E2E_PASSWORD or RW_ADMIN_PASSWORD (from .env) to run the e2e tests.');
  });
}

/** Fills in Keycloak's hosted login page (the browser must already be on it). */
export async function fillKeycloakLogin(page: Page) {
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

/** Signs in from our sign-in page, then waits until the app knows who we are. */
export async function signIn(page: Page, returnTo = '/') {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole('button', { name: 'Continue with Keycloak' }).click();
  await fillKeycloakLogin(page);
  await page.getByTestId('user-role').getByText('admin').waitFor();
}

/** The signed-in page's access token, as `oidc-client-ts` keeps it in sessionStorage. */
export async function bearer(page: Page) {
  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
    return key ? (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token : null;
  });
  return { authorization: `Bearer ${token}` };
}
