import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixture = path.join(import.meta.dirname, 'fixtures', 'retrieval-notes.md');
const second = path.join(import.meta.dirname, 'fixtures', 'embedding-notes.txt');
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
  const other = await page.request.post(`/api/v1/workspaces/${ws.slug}/documents`, {
    headers,
    multipart: {
      files: { name: 'embedding-notes.txt', mimeType: 'text/plain', buffer: await readFile(second) },
    },
  });
  expect(other.status()).toBe(201);

  await page.goto(`/w/${ws.slug}`);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();
  const row = page.getByTestId('document-row').filter({ hasText: 'retrieval-notes' });
  const otherRow = page.getByTestId('document-row').filter({ hasText: 'embedding-notes' });
  await expect(row.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(otherRow.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByText(/2 documents · \d+ passages? · /)).toBeVisible();

  // Filters and search.
  const filters = page.getByRole('group', { name: 'Status' });
  await filters.getByRole('button', { name: 'Failed' }).click();
  await expect(filters.getByRole('button', { name: 'Failed' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No documents match.')).toBeVisible();
  await filters.getByRole('button', { name: 'Ready' }).click();
  await expect(filters.getByRole('button', { name: 'Failed' })).toHaveAttribute('aria-pressed', 'false');
  await expect(row).toBeVisible();
  await page.getByLabel('Search documents').fill('nothing like it');
  await expect(row).toBeHidden();
  await page.getByLabel('Search documents').fill('RETRIEVAL');
  await expect(row).toBeVisible();

  // The detail panel.
  await row.click();
  await expect(row.getByRole('button', { name: 'retrieval-notes' })).toHaveAttribute('aria-current', 'true');
  await expect(row.getByRole('cell').last()).toHaveAttribute('title', /\d{4}/);
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
  await filters.getByRole('button', { name: 'All' }).click();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const text = [...document.querySelectorAll('[data-testid=document-row]')]
        .find((r) => r.textContent?.includes('retrieval-notes'))
        ?.querySelector('[data-testid=status]')?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const reindexed = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/reindex'),
  );
  await panel.getByRole('button', { name: 'Reindex' }).click();
  expect((await reindexed).ok()).toBe(true);
  // The row was already Ready, so wait for the recorded sequence to show Queued or Processing, then
  // Ready, rather than for the badge.
  const backToReady = async () => {
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    const queued = seen.findIndex((s) => s === 'Queued' || s === 'Processing');
    return queued >= 0 && seen.slice(queued + 1).includes('Ready');
  };
  await expect.poll(backToReady, { timeout: 60_000 }).toBe(true);
  await expect(panel.getByRole('button', { name: 'Delete' })).toBeEnabled();

  // Delete asks first, then the row goes and the empty state points to Upload.
  await panel.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this document?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toBeHidden();
  // The panel's buttons went with the document, so focus moves to the table.
  await expect(page.getByRole('table', { name: 'Documents' })).toBeFocused();

  // Deleting the last one leaves the empty state, with focus on the page's heading.
  await page.getByLabel('Search documents').fill('');
  await otherRow.click();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeFocused();
  await page.getByRole('link', { name: 'Upload files' }).click();
  await expect(page.getByRole('heading', { name: 'Upload material' })).toBeVisible();
});
