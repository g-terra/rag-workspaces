import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { UploadResult } from '@rag/shared';
import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixtures = path.join(import.meta.dirname, 'fixtures');
const ws = { name: `E2E Upload ${Date.now().toString(36)}`, slug: `e2e-${Date.now().toString(36)}-up` };

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

/** The id of the document the next upload answer names. */
async function nextUploadedId(page: Page) {
  const res = await page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/workspaces/${ws.slug}/documents`),
  );
  return ((await res.json()) as UploadResult).data[0]!.document.id;
}

/** The page doesn't follow ingestion yet, so ask the API until the document is ready. */
async function expectReadyInApi(page: Page, id: string) {
  const headers = await bearer(page);
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/workspaces/${ws.slug}/documents/${id}`, { headers });
        return ((await res.json()) as { status: string }).status;
      },
      { timeout: 60_000 },
    )
    .toBe('ready');
}

test('uploads files with progress; a second copy is skipped and bad files are refused', async ({ page }) => {
  await signIn(page, '/workspaces');
  const created = await page.request.post('/api/v1/workspaces', { headers: await bearer(page), data: ws });
  expect(created.status()).toBe(201);
  await page.reload();
  await page.getByRole('link', { name: `Open ${ws.name}` }).click();

  // The sidebar's Workspace section leads to the upload page.
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page.getByRole('heading', { name: 'Upload material' })).toBeVisible();

  // Hold the upload for a moment so the Uploading state can be seen.
  await page.route(`**/api/v1/workspaces/${ws.slug}/documents`, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });

  // Browse files: Uploading with a progress bar, then the API's answer, Queued.
  let uploaded = nextUploadedId(page);
  await page.getByLabel('Choose files to upload').setInputFiles(path.join(fixtures, 'retrieval-notes.md'));
  const notes = page.getByTestId('upload-row').filter({ hasText: 'retrieval-notes.md' });
  await expect(notes.getByTestId('status')).toHaveText('Uploading');
  await expect(notes.getByRole('progressbar')).toBeVisible();
  await expect(notes.getByTestId('status')).toHaveText('Queued');
  await expect(notes).toContainText('waiting for the ingest flow');
  await expectReadyInApi(page, await uploaded);

  // Drop a file on the drop zone.
  const text = await readFile(path.join(fixtures, 'embedding-notes.txt'), 'utf8');
  const dropped = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], 'embedding-notes.txt', { type: 'text/plain' }));
    return dt;
  }, text);
  uploaded = nextUploadedId(page);
  await page.getByTestId('drop-zone').dispatchEvent('drop', { dataTransfer: dropped });
  const drop = page.getByTestId('upload-row').filter({ hasText: 'embedding-notes.txt' });
  await expect(drop.getByTestId('status')).toHaveText('Queued');
  await expectReadyInApi(page, await uploaded);

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

  await expect(page.getByRole('heading', { name: /This session · 2 uploaded, 0 uploading/ })).toBeVisible();
});

test('sends at most three files at once; the rest wait their turn', async ({ page }) => {
  await signIn(page, '/workspaces');
  const created = await page.request.post('/api/v1/workspaces', { headers: await bearer(page), data: ws });
  expect(created.status()).toBe(201);
  await page.goto(`/w/${ws.slug}/upload`);
  await expect(page.getByRole('heading', { name: 'Upload material' })).toBeVisible();

  // A drop beside the zone is cancelled, so the browser doesn't open the file and leave the page.
  const prevented = await page.evaluate(() => {
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    document.body.dispatchEvent(drop);
    return drop.defaultPrevented;
  });
  expect(prevented).toBe(true);

  // Hold each upload long enough to see the fourth file wait.
  await page.route(`**/api/v1/workspaces/${ws.slug}/documents`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const names = ['one.md', 'two.md', 'three.md', 'four.md'];
  await page.getByLabel('Choose files to upload').setInputFiles(
    names.map((name) => ({
      name,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`# ${name}\n\nQueue ${ws.slug}`),
    })),
  );
  const status = (name: string) =>
    page.getByTestId('upload-row').filter({ hasText: name }).getByTestId('status');
  await expect(status('four.md')).toHaveText('Waiting');
  for (const name of names.slice(0, 3)) await expect(status(name)).toHaveText('Uploading');
  await expect(page.getByText('This session: 0 uploaded, 3 uploading, 1 waiting')).toBeAttached();

  for (const name of names) await expect(status(name)).toHaveText('Queued', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /This session · 4 uploaded, 0 uploading$/ })).toBeVisible();
});
