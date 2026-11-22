import { expect, test, type Page } from '@playwright/test';
import { requireCredentials, signIn } from './sign-in';

requireCredentials();

const run = Date.now().toString(36);
const a = { name: `E2E Alpha ${run}`, slug: `e2e-${run}-a` };
const b = { name: `E2E Beta ${run}`, slug: `e2e-${run}-b` };
const created: string[] = [];

/** The signed-in page's access token, as `oidc-client-ts` keeps it in sessionStorage. */
async function bearer(page: Page) {
  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
    return key ? (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token : null;
  });
  return { authorization: `Bearer ${token}` };
}

async function createThroughApi(page: Page, ws: { name: string; slug: string }) {
  created.push(ws.slug);
  const res = await page.request.post('/api/v1/workspaces', {
    headers: await bearer(page),
    data: { ...ws, description: 'Made by the Playwright test' },
  });
  expect(res.status()).toBe(201);
}

// Delete what the test made, with the page's own bearer token, even when the test failed.
test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const slug of created.splice(0)) {
    const res = await page.request.delete(`/api/v1/workspaces/${slug}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('lists workspaces, opens one, switches between them and reopens the last one', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createThroughApi(page, a);
  await createThroughApi(page, b);
  await page.reload();

  // Both are in "All workspaces"; a card opens its workspace.
  await expect(page.getByText(`/v1/workspaces/${a.slug}`)).toBeVisible();
  await expect(page.getByText(`/v1/workspaces/${b.slug}`)).toBeVisible();
  await page.getByRole('link', { name: `Open ${b.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${b.slug}$`));
  await expect(page.getByRole('heading', { name: b.name })).toBeVisible();
  await expect(page.getByTestId('current-workspace')).toHaveText(b.name);

  // The switcher lists them; picking Alpha opens it.
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: new RegExp(a.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${a.slug}$`));
  await expect(page.getByTestId('current-workspace')).toHaveText(a.name);

  // `/` reopens the last used workspace.
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/w/${a.slug}$`));

  // The admin nav leads back to the list.
  await page.getByRole('link', { name: 'All workspaces' }).first().click();
  await expect(page).toHaveURL(/\/workspaces$/);
});

test('an unknown workspace says it was not found or is not accessible', async ({ page }) => {
  await signIn(page, `/w/e2e-${run}-missing`);
  await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  await page.getByRole('link', { name: 'See all workspaces' }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});
