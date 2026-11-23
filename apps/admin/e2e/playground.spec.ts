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

/** Chat mode's box is labelled "Message" for the first message and "Follow-up" after it. */
const send = async (page: Page, message: string) => {
  await page.getByLabel(/^(Message|Follow-up)$/).fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
};

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const slug of [loose.slug, strict.slug]) {
    const res = await page.request.delete(`/api/v1/workspaces/${slug}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('streams an answer with its sources, takes feedback, says when nothing matches, and stops', async ({
  page,
}) => {
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
  // The answer is markdown: the stand-in's bold lead-in is bold, with no asterisks left.
  await expect(page.getByTestId('answer').locator('strong')).toHaveText('Based on the provided context:');
  await expect(page.getByTestId('answer')).not.toContainText('**');
  await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();

  // Rating the answer: thumbs down, then a comment, and the API has both afterwards.
  const answerId = (await page.getByText(/^ans_/).textContent())!;
  await page.getByRole('button', { name: 'Not helpful' }).click();
  await expect(page.getByText('Thanks, feedback saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Feedback comment').fill('  it quoted the heading  ');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thanks, feedback and comment saved')).toBeVisible();
  const rated = await page.request.get(`/api/v1/workspaces/${loose.slug}/answers/${answerId}`, { headers });
  expect(await rated.json()).toMatchObject({
    feedback: { rating: 'down', comment: 'it quoted the heading' },
  });

  // The passages the model was given are listed, and one opens with the text around it.
  const sources = page.getByRole('complementary', { name: 'Sources' });
  await expect(sources.getByTestId('source')).toHaveCount(1);
  await expect(sources).toContainText('retrieval-notes');
  await sources.getByTestId('source').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'retrieval-notes' })).toBeVisible();
  await expect(dialog.getByTestId('passage-text')).toContainText('Retrieval-augmented generation');
  await expect(dialog.getByText(/^psg_/)).toBeVisible();

  // The passage links to its document, which opens selected in the library.
  await dialog.getByRole('link', { name: 'Open the document' }).click();
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Selected document' });
  await expect(panel.getByRole('heading', { name: 'retrieval-notes' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Playground' })).toBeVisible();

  // Search mode: the same passages, scored, with no model call, and one opens.
  await page.getByRole('tab', { name: 'Search' }).click();
  await expect(page).toHaveURL(/mode=search/);
  await page.getByLabel('Search passages').fill('retrieval');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('hit')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(/no model call$/)).toBeVisible();
  await expect(page.getByTestId('hit')).toContainText('retrieval-notes');
  await page.getByRole('button', { name: /^retrieval-notes · passage/ }).click();
  await expect(page.getByRole('dialog').getByTestId('passage-text')).toContainText(
    'Retrieval-augmented generation',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // A query nothing is close to says so, rather than showing an empty list.
  await page.getByLabel('Search passages').fill('Mongolian basketball referee');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing matched' })).toBeVisible({ timeout: 30_000 });

  // Asking again is a tab away, and the mode survives a reload.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Ask' }).click();
  await expect(page.getByLabel('Question')).toBeVisible();

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
  // The API stored that answer too, so it can be rated like any other.
  await page.getByRole('button', { name: 'Helpful', exact: true }).click();
  await expect(page.getByText('Thanks, feedback saved')).toBeVisible();
});

test('holds a conversation, answers a follow-up from it and starts a new one', async ({ page }) => {
  // Signing in, ingestion and two replies take longer than the default budget.
  test.setTimeout(240_000);
  await signIn(page, '/workspaces');
  const headers = await bearer(page);
  await fillWorkspace(page.request, headers, loose);

  // Chat mode is linkable, like the other modes.
  await page.goto(`/w/${loose.slug}/playground?mode=chat`);
  await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');

  // The first message creates the conversation and streams the reply, with its sources.
  await send(page, QUESTION);
  await expect(page.getByTestId('reply')).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.getByTestId('reply-meta')).toContainText(/\d+(\.\d+)? (ms|s)/, { timeout: 60_000 });
  await expect(page.getByTestId('conversation-id')).toHaveText(/^cnv_/);
  await expect(page.getByRole('complementary', { name: 'Sources' }).getByTestId('source')).toHaveCount(1);
  const conversationId = (await page.getByTestId('conversation-id').textContent())!;

  // A follow-up joins the same conversation: the thread keeps the earlier turn above it.
  await send(page, 'Why does that matter?');
  await expect(page.getByTestId('turn')).toHaveCount(2);
  await expect(page.getByTestId('reply').nth(1)).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.getByTestId('conversation-id')).toHaveText(conversationId);

  // The API has the whole thread, both sides of both turns, under that one conversation.
  const stored = await page.request.get(`/api/v1/workspaces/${loose.slug}/conversations/${conversationId}`, {
    headers,
  });
  const thread = (await stored.json()) as { messages: { role: string; content: string | null }[] };
  expect(thread.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(thread.messages[2]!.content).toBe('Why does that matter?');

  // Looking at another mode must not lose the thread: both panels stay mounted.
  await page.getByRole('tab', { name: 'Ask' }).click();
  await expect(page.getByLabel('Question')).toBeVisible();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByTestId('turn')).toHaveCount(2);

  // A new conversation starts empty, and the next message gets a different id.
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByTestId('turn')).toHaveCount(0);
  await expect(page.getByTestId('conversation-id')).toHaveCount(0);
  await send(page, QUESTION);
  await expect(page.getByTestId('conversation-id')).toHaveText(/^cnv_/, { timeout: 60_000 });
  expect(await page.getByTestId('conversation-id').textContent()).not.toBe(conversationId);
});
