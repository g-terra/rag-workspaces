import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixture = path.join(import.meta.dirname, 'fixtures', 'retrieval-notes.md');
const run = Date.now().toString(36);
const QUESTION = 'What is retrieval-augmented generation?';

/**
 * Two workspaces holding the same material, one per answer the test needs. The stand-in model embeds
 * with hashed bag-of-words vectors, which score far lower than a real embedding model, so the relevance
 * threshold decides the outcome: `loose` always has something relevant enough to answer from, `strict`
 * never does, which is what `grounded: false` means.
 */
const loose = { name: `E2E Playground ${run}`, slug: `e2e-${run}-pg`, settings: { minScore: 0.05 } };
const strict = { name: `E2E Playground ${run} strict`, slug: `e2e-${run}-pgs`, settings: { minScore: 0.9 } };

/** Creates a workspace, uploads the fixture and waits until it is indexed, so it can answer. */
async function fillWorkspace(request: APIRequestContext, headers: Record<string, string>, ws: typeof loose) {
  expect((await request.post('/api/v1/workspaces', { headers, data: ws })).status()).toBe(201);
  const upload = await request.post(`/api/v1/workspaces/${ws.slug}/documents`, {
    headers,
    multipart: {
      files: { name: 'retrieval-notes.md', mimeType: 'text/markdown', buffer: await readFile(fixture) },
    },
  });
  expect(upload.status()).toBe(201);
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/v1/workspaces/${ws.slug}/documents`, { headers });
        return ((await res.json()) as { data: { status: string }[] }).data[0]?.status;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe('ready');
}

const ask = async (page: Page, question: string) => {
  await page.getByLabel('Question').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
};

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const slug of [loose.slug, strict.slug]) {
    const res = await page.request.delete(`/api/v1/workspaces/${slug}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('streams an answer, says when nothing matches, and stops on request', async ({ page }) => {
  // Signing in, ingesting two documents and three answers take longer than the default budget.
  test.setTimeout(240_000);
  await signIn(page, '/workspaces');
  const headers = await bearer(page);
  await fillWorkspace(page.request, headers, loose);
  await fillWorkspace(page.request, headers, strict);

  await page.goto(`/w/${loose.slug}`);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Playground' }).click();
  await expect(page.getByRole('heading', { name: 'Playground' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();

  // The answer streams in, then the stored record's id and its meta line appear.
  await ask(page, QUESTION);
  await expect(page.getByTestId('answer')).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.getByTestId('answer-meta')).toContainText(/\d+(\.\d+)? (ms|s)/, { timeout: 60_000 });
  await expect(page.getByText(/^ans_/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();

  // Stop aborts the request. The route is held open rather than answered, so there is always a
  // request in flight to abort: letting the real answer race the click makes the test flaky.
  const answers = '**/v1/workspaces/*/answers';
  await page.route(answers, () => {});
  await ask(page, QUESTION);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText(/^Stopped\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask' })).toBeEnabled();
  await page.unroute(answers);

  // Nothing is relevant enough in the strict workspace, so the API answers `grounded: false`.
  await page.goto(`/w/${strict.slug}/playground`);
  await ask(page, QUESTION);
  await expect(page.getByRole('heading', { name: 'Not found in this workspace' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('link', { name: 'Upload material' })).toBeVisible();
});
