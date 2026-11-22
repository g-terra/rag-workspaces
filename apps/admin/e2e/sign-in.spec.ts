import { expect, test } from '@playwright/test';

// The seeded admin from .env (RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD), unless E2E_* say otherwise.
const username = process.env.E2E_USERNAME ?? process.env.RW_ADMIN_USERNAME ?? 'admin';
const password = process.env.E2E_PASSWORD ?? process.env.RW_ADMIN_PASSWORD;

test.beforeAll(() => {
  if (!password) throw new Error('Set E2E_PASSWORD or RW_ADMIN_PASSWORD (from .env) to run the e2e tests.');
});

test('signs in through Keycloak, survives a reload, and signs out', async ({ page }) => {
  // Anonymous visitors are sent to our sign-in page, remembering where they were going.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2F$/);

  // Our page hands over to Keycloak's hosted login.
  await page.getByRole('button', { name: 'Continue with Keycloak' }).click();
  await expect(page).toHaveURL(/\/realms\/rag-workspaces\/protocol\/openid-connect\/auth/);
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Back in the app: /v1/me answered with the bearer token, so we know who this is.
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByTestId('user-role')).toHaveText('admin');

  // The tokens are kept for this tab, so a reload doesn't go back to Keycloak.
  await page.reload();
  await expect(page.getByTestId('user-role')).toHaveText('admin');
  await expect(page).not.toHaveURL(/sign-in/);

  // Sign-out ends the Keycloak session too: coming back needs the password again.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole('button', { name: 'Continue with Keycloak' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('returns to the page asked for after signing in', async ({ page }) => {
  await page.goto('/sign-in?returnTo=%2F%3Ffrom%3De2e');
  await page.getByRole('button', { name: 'Continue with Keycloak' }).click();
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/\?from=e2e$/);
});

test('says so when Keycloak cannot be reached', async ({ page }) => {
  await page.route(/\/realms\/rag-workspaces\//, (route) => route.abort());
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue with Keycloak' }).click();
  await expect(page.getByRole('alert')).toContainText("Couldn't reach the sign-in service");
  await expect(page.getByRole('button', { name: 'Continue with Keycloak' })).toBeEnabled();
});

test('sends an anonymous visitor at an unknown address to sign in, keeping the address', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fno-such-page$/);
});
