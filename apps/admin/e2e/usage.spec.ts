import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// Unique per run: another worker drives the same stack and the same admin account.
const run = Date.now().toString(36);
const slug = `e2e-${run}-usage`;
const question = `What does E2E run ${run} measure?`;
const workspaces: string[] = [];

/** A workspace with one answered question, so its usage has something to show. */
async function workspaceWithTraffic(page: Page) {
  const headers = await bearer(page);
  workspaces.push(slug);
  const created = await page.request.post('/api/v1/workspaces', {
    headers,
    data: { slug, name: `E2E usage ${run}`, description: 'Made by the Playwright test' },
  });
  expect(created.status()).toBe(201);
  // The stand-in model answers without documents ("not found"), which is still a logged request.
  const asked = await page.request.post(`/api/v1/workspaces/${slug}/answers`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { question },
  });
  expect([200, 201]).toContain(asked.status());
}

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const made of workspaces.splice(0)) {
    const res = await page.request.delete(`/api/v1/workspaces/${made}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test("a workspace's usage page shows its traffic, and the log filters and pages", async ({ page }) => {
  await signIn(page, '/workspaces');
  await workspaceWithTraffic(page);

  // The workspace nav leads to its own usage page.
  await page.goto(`/w/${slug}`);
  await page.getByRole('link', { name: 'Usage' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/usage$`));
  await expect(page.getByRole('heading', { name: 'Usage analytics' })).toBeVisible();

  // Summary tiles and the charts' readouts.
  await expect(page.getByText('Latency p50 / p95')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requests per day' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Requests per day/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /95th percentile latency/ })).toBeVisible();

  // The question and the route it came through.
  await expect(page.getByRole('heading', { name: 'Top questions' })).toBeVisible();
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText('/v1/workspaces/:slug/answers').first()).toBeVisible();

  // The request log holds that request; a status nobody sent empties it.
  const log = page.getByRole('table', { name: 'Request log' });
  await expect(log.getByTestId('request-row').first()).toBeVisible();
  await page.getByLabel('Status', { exact: true }).fill('418');
  await expect(log.getByText('No request matches.')).toBeVisible();
  await page.getByLabel('Status', { exact: true }).fill('');
  await expect(log.getByTestId('request-row').first()).toBeVisible();

  // The Route filter offers the patterns seen in the range; the API matches a whole pattern.
  await page.getByLabel('Route', { exact: true }).selectOption('/v1/workspaces/:slug/answers');
  await expect(log.getByTestId('request-row').first()).toContainText('/v1/workspaces/:slug/answers');
  await page.getByLabel('Route', { exact: true }).selectOption('');

  // Paging starts on page 1 with nothing newer.
  await expect(page.getByText('Page 1 · newest first')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Newer' })).toBeDisabled();

  // Another range reloads every card.
  await page.getByRole('button', { name: '24 hours' }).click();
  await expect(page.getByRole('heading', { name: 'Requests per hour' })).toBeVisible();
});

test('the admin usage page covers every workspace', async ({ page }) => {
  await signIn(page, '/workspaces');
  await page.getByRole('link', { name: 'Usage' }).first().click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByRole('heading', { name: 'Usage analytics' })).toBeVisible();
  await expect(page.getByText('Error rate')).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Request log' }).getByTestId('request-row').first(),
  ).toBeVisible();
});
