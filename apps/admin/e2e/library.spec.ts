import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixture = path.join(import.meta.dirname, 'fixtures', 'retrieval-notes.md');
const run = Date.now().toString(36);
const ws = { name: `E2E Library ${run}`, slug: `e2e-${run}-lib` };

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

test('lists documents live, downloads, reindexes and deletes one', async ({ page }) => {
  await signIn(page, '/workspaces');
  const headers = await bearer(page);
  expect((await page.request.post('/api/v1/workspaces', { headers, data: ws })).status()).toBe(201);
  const bytes = await readFile(fixture);
  const upload = await page.request.post(`/api/v1/workspaces/${ws.slug}/documents`, {
    headers,
    multipart: { files: { name: 'retrieval-notes.md', mimeType: 'text/markdown', buffer: bytes } },
  });
  expect(upload.status()).toBe(201);

  await page.goto(`/w/${ws.slug}`);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();
  const row = page.getByTestId('document-row').filter({ hasText: 'retrieval-notes' });
  await expect(row.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByText(/1 document · \d+ passages? · /)).toBeVisible();

  // Filters and search.
  await page.getByRole('tab', { name: 'Failed' }).click();
  await expect(page.getByText('No documents match.')).toBeVisible();
  await page.getByRole('tab', { name: 'Ready' }).click();
  await expect(row).toBeVisible();
  await page.getByLabel('Search documents').fill('nothing like it');
  await expect(row).toBeHidden();
  await page.getByLabel('Search documents').fill('RETRIEVAL');
  await expect(row).toBeVisible();

  // The detail panel.
  await row.click();
  const panel = page.getByRole('complementary', { name: 'Selected document' });
  await expect(panel.getByRole('heading', { name: 'retrieval-notes' })).toBeVisible();
  await expect(panel).toContainText('retrieval-notes.md');

  // Download sends the bearer token and saves the original under its name.
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('retrieval-notes.md');
  expect(await readFile(await download.path())).toEqual(bytes);

  // Reindex goes back through the queue to Ready, live. Record each status the row shows, since
  // ingestion can pass Queued and Processing quicker than Playwright polls.
  await page.getByRole('tab', { name: 'All' }).click();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid=document-row] [data-testid=status]')?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await panel.getByRole('button', { name: 'Reindex' }).click();
  // The row was already Ready, so wait for the recorded sequence to end in Ready, not the badge.
  const seen = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  await expect.poll(async () => (await seen()).at(-1), { timeout: 60_000 }).toBe('Ready');
  expect((await seen())[0]).toMatch(/Queued|Processing/);

  // Delete asks first, then the row goes and the empty state points to Upload.
  await panel.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this document?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toBeHidden();
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Upload files' }).click();
  await expect(page.getByRole('heading', { name: 'Upload material' })).toBeVisible();
});
