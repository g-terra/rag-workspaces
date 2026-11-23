import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const fixture = path.join(import.meta.dirname, 'fixtures', 'retrieval-notes.md');
const run = Date.now().toString(36);
// The stand-in model's hashed embeddings score far below a real one, so the threshold is lowered to
// what it reaches; otherwise every reply would be "nothing was close enough".
const ws = { name: `E2E Conversations ${run}`, slug: `e2e-${run}-cnv`, settings: { minScore: 0.05 } };

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers });
  expect([204, 404]).toContain(res.status());
});

test('lists conversations, opens one, carries it on and deletes it', async ({ page }) => {
  // Signing in, ingestion and three replies take longer than the default budget.
  test.setTimeout(240_000);
  await signIn(page, '/workspaces');
  const headers = await bearer(page);
  expect((await page.request.post('/api/v1/workspaces', { headers, data: ws })).status()).toBe(201);
  const upload = await page.request.post(`/api/v1/workspaces/${ws.slug}/documents`, {
    headers,
    multipart: {
      files: { name: 'retrieval-notes.md', mimeType: 'text/markdown', buffer: await readFile(fixture) },
    },
  });
  expect(upload.status()).toBe(201);
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/workspaces/${ws.slug}/documents`, { headers });
        return ((await res.json()) as { data: { status: string }[] }).data[0]?.status;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe('ready');

  // Nothing has been said yet, so the screen offers the playground rather than an empty list.
  await page.goto(`/w/${ws.slug}`);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: 'Conversations' })
    .click();
  await expect(page.getByRole('heading', { name: 'No conversations yet' })).toBeVisible();

  // A conversation started in the playground links to itself here.
  await page.getByRole('link', { name: 'Open Chat' }).click();
  await page.getByLabel('Message').fill('What is retrieval-augmented generation?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('reply')).not.toBeEmpty({ timeout: 60_000 });
  const conversationId = (await page.getByTestId('conversation-id').textContent())!;
  await page.getByTestId('conversation-id').click();

  // The conversation is open, both sides of the turn are stored, and the reply kept its sources.
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await expect(page.getByTestId('conversation')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /retrieval/i }).first()).toBeVisible();
  await expect(page.getByTestId('stored-reply')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Sources' }).getByTestId('source')).toHaveCount(1);

  // A citation in a stored reply opens the same passage preview the playground uses.
  await page.getByRole('complementary', { name: 'Sources' }).getByTestId('source').first().click();
  await expect(page.getByRole('dialog').getByTestId('passage-text')).toContainText(
    'Retrieval-augmented generation',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // Carrying it on sends to the same conversation, which the API confirms.
  await page.getByLabel('Follow-up').fill('Why does that matter?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('reply')).not.toBeEmpty({ timeout: 60_000 });
  const stored = await page.request.get(`/api/v1/workspaces/${ws.slug}/conversations/${conversationId}`, {
    headers,
  });
  const thread = (await stored.json()) as { messages: { role: string }[] };
  expect(thread.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

  // A reload shows what was sent here as stored messages, not as live turns.
  await page.reload();
  await expect(page.getByTestId('stored-reply')).toHaveCount(2);

  // Deleting asks first, then the conversation and its messages are gone.
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/This can't be undone/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'No conversations yet' })).toBeVisible();
  const gone = await page.request.get(`/api/v1/workspaces/${ws.slug}/conversations/${conversationId}`, {
    headers,
  });
  expect(gone.status()).toBe(404);
});
