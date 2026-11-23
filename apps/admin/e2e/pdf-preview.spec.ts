import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// The PDF the smoke test ingests too: three short "Week" sections of course notes.
const pdf = path.join(import.meta.dirname, '..', '..', '..', 'poc', 'samples', 'ouc', 'cos512-notes.pdf');
const run = Date.now().toString(36);
// The stand-in model's hashed embeddings score low, so the threshold is lowered to always find a passage.
const ws = { name: `E2E Preview ${run}`, slug: `e2e-${run}-pdf`, settings: { minScore: 0.05 } };

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

test('a PDF opens in the app: from the library, and from a passage on its page', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, '/workspaces');
  const headers = await bearer(page);
  expect((await page.request.post('/api/v1/workspaces', { headers, data: ws })).status()).toBe(201);
  const upload = await page.request.post(`/api/v1/workspaces/${ws.slug}/documents`, {
    headers,
    multipart: {
      files: { name: 'cos512-notes.pdf', mimeType: 'application/pdf', buffer: await readFile(pdf) },
    },
  });
  expect(upload.status()).toBe(201);
  const doc = ((await upload.json()) as { data: { document: { id: string } }[] }).data[0]!.document;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/workspaces/${ws.slug}/documents`, { headers });
        return ((await res.json()) as { data: { status: string }[] }).data[0]?.status;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe('ready');

  // The library previews the PDF from its first page, fetched with the token into an object URL.
  await page.goto(`/w/${ws.slug}/documents?doc=${encodeURIComponent(doc.id)}`);
  const panel = page.getByRole('complementary', { name: 'Selected document' });
  await panel.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('dialog', { name: 'cos512-notes' });
  await expect(preview.getByTestId('pdf-preview')).toHaveAttribute('src', /^blob:[^#]+$/);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  // A search hit's passage offers its page, and the preview opens on it, over the passage.
  await page.goto(`/w/${ws.slug}/playground?mode=search`);
  await page.getByLabel('Search passages').fill('retriever language model');
  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('button', { name: /^cos512-notes · page \d+/ })
    .first()
    .click();
  const view = page.getByRole('button', { name: /^View page \d+$/ });
  const pageNumber = (await view.textContent())!.match(/\d+/)![0];
  await view.click();
  await expect(page.getByText(`Opened on page ${pageNumber}`)).toBeVisible();
  await expect(page.getByTestId('pdf-preview')).toHaveAttribute(
    'src',
    new RegExp(`^blob:.+#page=${pageNumber}$`),
  );

  // Closing the preview goes back to the passage, not out of both.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pdf-preview')).toHaveCount(0);
  await expect(page.getByTestId('passage-text')).toBeVisible();
});
