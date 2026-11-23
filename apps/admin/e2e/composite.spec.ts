import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const run = Date.now().toString(36);
const sources = [
  { name: `E2E Source A ${run}`, slug: `e2e-${run}-sa` },
  { name: `E2E Source B ${run}`, slug: `e2e-${run}-sb` },
];
const composite = { name: `E2E Composite ${run}`, slug: `e2e-${run}-mix` };

// The composite first: deleting it never touches its sources, and deleting them first would only shrink it.
test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const slug of [composite.slug, ...sources.map((s) => s.slug)]) {
    const res = await page.request.delete(`/api/v1/workspaces/${slug}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('an admin combines two workspaces into a composite, which has no documents of its own', async ({
  page,
}) => {
  await signIn(page, '/workspaces');
  for (const ws of sources) {
    const res = await page.request.post('/api/v1/workspaces', { headers: await bearer(page), data: ws });
    expect(res.status()).toBe(201);
  }
  await page.reload();

  await page.getByRole('button', { name: 'New composite' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(composite.name);
  await dialog.getByLabel('Slug').fill(composite.slug);
  await dialog.getByRole('button', { name: 'Create composite' }).click();
  await expect(dialog.getByText('Pick at least two workspaces.')).toBeVisible();
  for (const ws of sources) await dialog.getByRole('checkbox', { name: new RegExp(ws.name) }).check();
  await dialog.getByRole('button', { name: 'Create composite' }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${composite.slug}$`));
  await expect(page.getByText(`${sources[0]!.slug}, ${sources[1]!.slug}`)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByRole('link', { name: 'Playground' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Upload' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Documents' })).toHaveCount(0);
  // A typed address for a screen it doesn't have goes back to its overview.
  await page.goto(`/w/${composite.slug}/upload`);
  await expect(page).toHaveURL(new RegExp(`/w/${composite.slug}$`));

  // Settings: sources instead of embedding, chunking and reindex.
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(page.getByLabel('Embedding model')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reindex workspace' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: new RegExp(sources[1]!.name) }).uncheck();
  await page.getByRole('button', { name: 'Save sources' }).click();
  await expect(page.getByText('Pick at least two workspaces.')).toBeVisible();
});
