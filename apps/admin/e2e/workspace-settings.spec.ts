import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// Unique per run: another worker drives the same stack and the same admin account.
const run = Date.now().toString(36);
const slug = `e2e-${run}-settings`;
const made: string[] = [];

async function createWorkspace(page: Page) {
  made.push(slug);
  const res = await page.request.post('/api/v1/workspaces', {
    headers: await bearer(page),
    data: { slug, name: `E2E settings ${run}`, description: 'Made by the Playwright test' },
  });
  expect(res.status()).toBe(201);
}

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const workspace of made.splice(0)) {
    const res = await page.request.delete(`/api/v1/workspaces/${workspace}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('an admin changes a workspace’s name and retrieval settings, and they stick', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createWorkspace(page);

  // The workspace nav leads to the page.
  await page.goto(`/w/${slug}`);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();

  // The slug is shown but fixed, and the embedding model is read-only: PATCH refuses both.
  await expect(page.getByLabel('Slug')).toBeDisabled();
  await expect(page.getByLabel('Slug')).toHaveValue(slug);
  await expect(page.getByLabel('Embedding model', { exact: true })).toBeDisabled();

  // …and changes through a reindex, which the button beside it opens, with the model in use picked.
  await page.getByRole('button', { name: 'Change embedding model' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Embedding provider')).toHaveValue('lmstudio');
  await expect(dialog.getByLabel('Embedding model')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // An empty setting shows the API's own default as its placeholder, not just "Default".
  await expect(page.getByLabel('Chunk size')).toHaveAttribute('placeholder', /^Default: \d+$/);
  await expect(page.getByLabel('Top-k passages')).toHaveAttribute('placeholder', /^Default: \d+$/);
  await expect(page.getByLabel('Relevance threshold')).toHaveAttribute('placeholder', /^Default: 0?\.\d+$/);
  await expect(page.getByLabel('System prompt')).toHaveAttribute('placeholder', /Cite with square brackets/);

  // Nothing to save until something changes.
  const saveButton = page.getByRole('button', { name: 'Save changes' });
  await expect(saveButton).toBeDisabled();

  await page.getByLabel('Name').fill(`E2E renamed ${run}`);
  await page.getByLabel('Top-k passages').fill('7');
  await page.getByLabel('Relevance threshold').fill('0.4');
  // The smoke stack sets no DEFAULT_REASONING_EFFORT, so the note says nothing is sent.
  await expect(page.getByText(/Default: not sent, so the model decides\./)).toBeVisible();
  await page.getByLabel('Reasoning effort').selectOption('none');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(saveButton).toBeDisabled();

  // The name is what the breadcrumb and the switcher read.
  await expect(page.getByText(`E2E renamed ${run}`).first()).toBeVisible();

  // Reloaded from the API, not from the form that was just typed into.
  await page.reload();
  await expect(page.getByLabel('Top-k passages')).toHaveValue('7');
  await expect(page.getByLabel('Relevance threshold')).toHaveValue('0.4');
  await expect(page.getByLabel('Reasoning effort')).toHaveValue('none');

  // Emptying a number sends null, and the field goes back to showing the API's own default.
  await page.getByLabel('Top-k passages').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Top-k passages')).toHaveValue('');
  await expect(page.getByLabel('Top-k passages')).toHaveAttribute('placeholder', /^Default: \d+$/);
});

test('the form refuses what the API would resolve wrongly', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createWorkspace(page);
  await page.goto(`/w/${slug}/settings`);

  // A provider with no model would answer with another provider's default model.
  await page.getByLabel('Chat provider').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Pick a model for this provider.')).toBeVisible();

  // An overlap as wide as the chunk leaves ingestion with no progress to make.
  await page.getByLabel('Chat provider').selectOption('');
  await page.getByLabel('Chunk size').fill('400');
  await page.getByLabel('Chunk overlap').fill('400');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Use less than the chunk size (400).')).toBeVisible();

  // Out of the range the API's own schema allows.
  await page.getByLabel('Chunk overlap').fill('100');
  await page.getByLabel('Top-k passages').fill('99');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Use at most 50.')).toBeVisible();

  // Nothing above reached the API: reloading shows the workspace untouched.
  await page.reload();
  await expect(page.getByLabel('Chunk size')).toHaveValue('');
  await expect(page.getByLabel('Top-k passages')).toHaveValue('');
});

test('an admin reindexes a workspace', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createWorkspace(page);
  await page.goto(`/w/${slug}/settings`);

  await page.getByRole('button', { name: 'Reindex workspace' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Reindex "E2E settings ${run}"?`)).toBeVisible();
  // It opens on the model the workspace already uses, so confirming changes nothing but the chunking.
  await expect(dialog.getByLabel('Embedding model')).not.toHaveValue('');
  await expect(dialog.getByText(/Keeping the model it has/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Reindex workspace' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // A workspace with no documents has nothing to wait for, so it is active again at once and the
  // button is ready for another run.
  await expect(page.getByRole('button', { name: 'Reindex workspace' })).toBeEnabled();

  // Unsaved chunking would need a second run to apply, so the button waits for the save.
  await page.getByLabel('Chunk size').fill('500');
  await expect(page.getByRole('button', { name: 'Reindex workspace' })).toBeDisabled();
  await expect(page.getByText(/Save your changes first: a reindex/)).toBeVisible();
});
