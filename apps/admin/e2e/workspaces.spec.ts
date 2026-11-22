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

test('an admin creates workspaces from the list and from the switcher', async ({ page }) => {
  const c = { name: `E2E Gamma ${run}`, slug: `e2e-${run}-c` };
  const d = { name: `E2E Delta ${run}`, slug: `e2e-${run}-d` };
  await signIn(page, '/workspaces');

  // From "All workspaces": the slug follows the name until edited.
  await page.getByRole('button', { name: 'New workspace' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create workspace' });
  await dialog.getByLabel('Name').fill('Thesis Research');
  await expect(dialog.getByLabel('Slug')).toHaveValue('thesis-research');
  created.push(c.slug);
  await fillCreateDialog(page, c);
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}$`));
  await expect(page.getByRole('heading', { name: c.name })).toBeVisible();
  await expect(page.getByTestId('current-workspace')).toHaveText(c.name);

  // From the switcher; a taken slug is refused under the slug field.
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page.getByRole('button', { name: /Create workspace/ }).click();
  await fillCreateDialog(page, { name: 'Duplicate', slug: c.slug });
  await expect(dialog.getByText(`The slug "${c.slug}" is taken.`)).toBeVisible();
  await expect(dialog.getByLabel('Slug')).toHaveAccessibleDescription(`The slug "${c.slug}" is taken.`);
  created.push(d.slug);
  await fillCreateDialog(page, d);
  await expect(page).toHaveURL(new RegExp(`/w/${d.slug}$`));
  await expect(page.getByTestId('current-workspace')).toHaveText(d.name);

  // Closing the dialog gives focus back to what opened it.
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page.getByRole('button', { name: /Create workspace/ }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toBeFocused();

  // The list shows the new one without a reload.
  await page.getByRole('link', { name: 'All workspaces' }).first().click();
  await expect(page.getByText(`/v1/workspaces/${d.slug}`)).toBeVisible();
  const newButton = page.getByRole('button', { name: 'New workspace' }).first();
  await newButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(newButton).toBeFocused();
});

async function fillCreateDialog(page: Page, ws: { name: string; slug: string }) {
  const dialog = page.getByRole('dialog', { name: 'Create workspace' });
  await dialog.getByLabel('Name').fill(ws.name);
  await dialog.getByLabel('Slug').fill(ws.slug);
  await dialog.getByLabel('Description').fill('Made by the Playwright test');
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
}
