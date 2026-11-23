import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const run = Date.now().toString(36);
const a = { name: `E2E Alpha ${run}`, slug: `e2e-${run}-a` };
const b = { name: `E2E Beta ${run}`, slug: `e2e-${run}-b` };
const created: string[] = [];

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
  // Escape goes to whatever has focus: wait until the dialog has taken it from the switcher's menu, or a
  // fast machine presses it while the menu still holds focus and only the menu closes.
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toBeFocused();

  // The list shows the new one without a reload.
  await page.getByRole('link', { name: 'All workspaces' }).first().click();
  await expect(page.getByText(`/v1/workspaces/${d.slug}`)).toBeVisible();
  const newButton = page.getByRole('button', { name: 'New workspace' }).first();
  await newButton.click();
  await expect(dialog).toBeVisible();
  // Escape goes to whatever has focus: wait until the dialog has taken it from the switcher's menu, or a
  // fast machine presses it while the menu still holds focus and only the menu closes.
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
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

test('an admin sets up a workspace step by step, and the settings it was created with stick', async ({
  page,
}) => {
  const w = { name: `E2E Wizard ${run}`, slug: `e2e-${run}-wizard` };
  await signIn(page, '/workspaces');
  await page.getByRole('button', { name: 'New workspace' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create workspace' });
  await dialog.getByLabel('Name').fill(w.name);
  await dialog.getByLabel('Slug').fill(w.slug);

  // Models: LM Studio's models are listed (the smoke stack's stand-in model server).
  await dialog.getByRole('button', { name: 'Next: Models' }).click();
  await dialog.getByLabel('Chat provider').selectOption('lmstudio');
  const chatModel = dialog.getByLabel('Chat model');
  await chatModel.selectOption({ index: 1 });
  const picked = await chatModel.inputValue();
  expect(picked).not.toBe('');

  // A hosted provider without a key in .env asks for one, and a made-up key does not pass.
  await dialog.getByLabel('Embedding provider').selectOption('gemini');
  await dialog.getByLabel('gemini API key').fill('not-a-real-gemini-key-000');
  await dialog.getByRole('button', { name: 'Check key' }).click();
  await expect(dialog.getByText(/The key doesn't work|couldn't be asked/)).toBeVisible();
  // Creating now would leave Gemini without a key, so the wizard says so instead.
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(dialog.getByText('Add a key for gemini, or pick another provider.')).toBeVisible();
  await dialog.getByLabel('Embedding provider').selectOption('');

  // Retrieval, then the review lists what was chosen.
  await dialog.getByRole('button', { name: 'Next: Retrieval' }).click();
  await dialog.getByLabel('Top-k passages').fill('6');
  await dialog.getByRole('button', { name: 'Next: Review' }).click();
  await expect(dialog.getByText(`lmstudio / ${picked}`)).toBeVisible();

  created.push(w.slug);
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${w.slug}$`));

  await page.goto(`/w/${w.slug}/settings`);
  await expect(page.getByLabel('Top-k passages')).toHaveValue('6');
  await expect(page.getByLabel('Chat provider')).toHaveValue('lmstudio');
  await expect(page.getByLabel('Chat model')).toHaveValue(picked);
});
