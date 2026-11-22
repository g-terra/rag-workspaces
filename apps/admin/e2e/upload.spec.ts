import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixtures = path.join(import.meta.dirname, 'fixtures');
const ws = { name: `E2E Upload ${Date.now().toString(36)}`, slug: `e2e-${Date.now().toString(36)}-up` };

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

test('uploads files and follows them live to Ready; a second copy is skipped', async ({ page }) => {
  await signIn(page, '/workspaces');
  const created = await page.request.post('/api/v1/workspaces', { headers: await bearer(page), data: ws });
  expect(created.status()).toBe(201);
  await page.reload();
  await page.getByRole('link', { name: `Open ${ws.name}` }).click();

  // The sidebar's Workspace section leads to the upload page, which opens the status stream.
  const stream = page.waitForRequest((r) => r.url().endsWith(`/workspaces/${ws.slug}/documents/events`));
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page.getByRole('heading', { name: 'Upload material' })).toBeVisible();
  await stream;

  // Hold the upload for a moment so the Uploading state can be seen.
  await page.route(`**/api/v1/workspaces/${ws.slug}/documents`, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });

  // Record every status the first row shows: ingestion can pass Queued and Processing quicker than
  // Playwright polls.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid=upload-row] [data-testid=status]')?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // Browse files.
  await page.getByLabel('Choose files to upload').setInputFiles(path.join(fixtures, 'retrieval-notes.md'));
  const notes = page.getByTestId('upload-row').filter({ hasText: 'retrieval-notes.md' });
  await expect(notes.getByTestId('status')).toHaveText('Uploading');
  await expect(notes.getByRole('progressbar')).toBeVisible();
  // Then Ready with its passages, all from the stream: the page never reloads.
  await expect(notes.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(notes).toContainText(/\d+ passages?/);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen[0]).toBe('Uploading');
  expect(seen.slice(1, -1).length).toBeGreaterThan(0);
  expect(seen.slice(1, -1).every((s) => s === 'Queued' || s === 'Processing')).toBe(true);
  expect(seen.at(-1)).toBe('Ready');

  // Drop a file on the drop zone.
  const text = await readFile(path.join(fixtures, 'embedding-notes.txt'), 'utf8');
  const dropped = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], 'embedding-notes.txt', { type: 'text/plain' }));
    return dt;
  }, text);
  await page.getByTestId('drop-zone').dispatchEvent('drop', { dataTransfer: dropped });
  const drop = page.getByTestId('upload-row').filter({ hasText: 'embedding-notes.txt' });
  await expect(drop.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The same file again is skipped as a duplicate.
  await page.getByLabel('Choose files to upload').setInputFiles(path.join(fixtures, 'retrieval-notes.md'));
  const again = page.getByTestId('upload-row').filter({ hasText: 'retrieval-notes.md' }).first();
  await expect(again.getByTestId('status')).toHaveText('Skipped');
  await expect(again).toContainText('Skipped: identical file already in this workspace');

  // A file the browser refuses, and one the API refuses by its content (a NUL byte isn't text).
  await page.getByLabel('Choose files to upload').setInputFiles([
    { name: 'slides.pptx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') },
    { name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from([0x61, 0x00, 0x62]) },
  ]);
  for (const name of ['slides.pptx', 'binary.txt']) {
    const row = page.getByTestId('upload-row').filter({ hasText: name });
    await expect(row.getByTestId('status')).toHaveText('Not uploaded');
    await expect(row).toContainText('Not a supported file. Use PDF, DOCX, TXT or MD.');
  }

  await expect(page.getByRole('heading', { name: /This session · 2 ready, 0 in progress/ })).toBeVisible();
});
