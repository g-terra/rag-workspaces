import { expect, test } from '@playwright/test';
import { requireCredentials, signIn } from './sign-in';

requireCredentials();

test('the sidebar shows the version, and System shows the services and links to the tools', async ({
  page,
}) => {
  await signIn(page, '/');
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+/);

  await page.getByRole('link', { name: 'System' }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole('heading', { name: 'System', level: 1 })).toBeVisible();
  await expect(page.getByTestId('health-summary')).toBeVisible();
  await expect(page.getByTestId('versions')).toContainText('API v');

  // The four services /ready checks, each answering on the smoke stack.
  for (const name of ['Postgres', 'ChromaDB', 'Langflow', 'Keycloak']) {
    const row = page.getByTestId('health-row').filter({ hasText: name }).first();
    await expect(row).toContainText(/\d+ ms/);
  }
  await expect(page.getByTestId('health-row').filter({ hasText: 'LM Studio' })).toBeVisible();

  const tools = page.getByRole('region', { name: 'Tools' });
  await expect(tools.getByRole('link', { name: /Langflow/ })).toHaveAttribute('href', /^http:\/\/.+\/$/);
  await expect(tools.getByRole('link', { name: /Keycloak/ })).toHaveAttribute(
    'href',
    /\/admin\/master\/console\/#\/rag-workspaces$/,
  );
  await expect(tools.getByRole('link', { name: /API docs/ })).toHaveAttribute('href', '/api/docs/');
});
