import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// The stand-in model server also serves a tiny docs site (poc/standin/server.ts), and the smoke stack
// lets Langflow crawl it (CRAWL_ALLOWED_HOSTS: standin).
const SITE = 'http://standin:1234/site/docs/';
const run = Date.now().toString(36);
const ws = { name: `E2E Websites ${run}`, slug: `e2e-${run}-web` };

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${ws.slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

test('imports a docs website, shows its pages with links, crawls it again and removes it', async ({
  page,
}) => {
  await signIn(page, '/workspaces');
  expect(
    (await page.request.post('/api/v1/workspaces', { headers: await bearer(page), data: ws })).status(),
  ).toBe(201);

  await page.goto(`/w/${ws.slug}/documents`);
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();
  // An empty workspace offers both ways in; use the one in the top bar.
  await page.getByRole('button', { name: 'Add website' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Import a website' });
  await dialog.getByLabel('Start URL').fill(SITE);
  await dialog.getByLabel('Max pages').fill('10');
  await dialog.getByLabel('Leave out (optional)').fill('fr-ca/');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByRole('alert')).toContainText('must start with "/"');
  await dialog.getByLabel('Leave out (optional)').fill('/site/docs/fr-ca/');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();

  const websites = page.getByRole('region', { name: 'Websites' });
  const site = websites.getByTestId('site-row');
  await expect(site).toContainText('standin:1234/site/docs');
  await expect(site.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(site).toContainText('3 pages');
  await expect(site).toContainText('3 new');

  // Each page is a document with a globe, and its panel links to the page.
  const install = page.getByTestId('document-row').filter({ hasText: 'Install' });
  await expect(install.getByLabel('Web page')).toBeVisible();
  await expect(install.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await install.click();
  const panel = page.getByRole('complementary', { name: 'Selected document' });
  await expect(panel.getByRole('link', { name: 'standin:1234/site/docs/install' })).toHaveAttribute(
    'href',
    `${SITE}install`,
  );
  await expect(page.getByTestId('document-row')).toHaveCount(3);

  await site.getByRole('button', { name: 'Crawl again' }).click();
  await expect(site).toContainText('3 unchanged', { timeout: 60_000 });
  await expect(site.getByTestId('status')).toHaveText('Ready');

  await site.getByRole('button', { name: 'Remove standin:1234/site/docs' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove this website?' });
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(websites).toBeHidden();
  await expect(page.getByTestId('document-row')).toHaveCount(0);
});
