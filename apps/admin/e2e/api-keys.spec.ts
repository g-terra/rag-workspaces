import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// Unique per run: another worker drives the same stack and the same admin account.
const run = Date.now().toString(36);
const slug = `e2e-${run}-keys`;
const name = `E2E key ${run}`;
const workspaces: string[] = [];

async function createWorkspace(page: Page) {
  workspaces.push(slug);
  const res = await page.request.post('/api/v1/workspaces', {
    headers: await bearer(page),
    data: { slug, name: `E2E keys ${run}`, description: 'Made by the Playwright test' },
  });
  expect(res.status()).toBe(201);
}

// Revoke what the test made (keys are never deleted, so they stay listed) and drop the workspace.
test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  const listed = await page.request.get('/api/v1/api-keys', { headers });
  if (listed.ok()) {
    const { data } = (await listed.json()) as {
      data: { id: string; name: string; revokedAt: string | null }[];
    };
    for (const key of data) {
      if (key.name.includes(run) && !key.revokedAt) {
        await page.request.delete(`/api/v1/api-keys/${key.id}`, { headers });
      }
    }
  }
  for (const made of workspaces.splice(0)) {
    const res = await page.request.delete(`/api/v1/workspaces/${made}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('an admin creates a key, sees its secret once, edits it and revokes it', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createWorkspace(page);

  // The admin nav leads to the page.
  await page.getByRole('link', { name: 'API keys' }).click();
  await expect(page).toHaveURL(/\/api-keys$/);
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();

  // Create a key for the new workspace, expiring in 30 days.
  await page.getByRole('button', { name: 'Create key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API key' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('radio', { name: /editor/ }).check();
  await dialog.getByRole('checkbox', { name: slug, exact: true }).check();
  await dialog.getByLabel('Expires').selectOption('30d');
  await dialog.getByRole('button', { name: 'Create key' }).click();

  // The secret is shown once, with a request that uses it.
  const secret = page.getByLabel('Secret');
  await expect(secret).toHaveValue(/^rw_/);
  await expect(page.getByText(`${name} created`)).toBeVisible();
  await expect(page.getByTestId('curl-example')).toContainText(`/api/v1/workspaces/${slug}/answers`);
  await expect(page.getByTestId('curl-example')).toContainText(await secret.inputValue());
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // Reopening starts an empty form: the secret just shown is not shown again.
  await page.getByRole('button', { name: 'Create key' }).first().click();
  await expect(dialog.getByLabel('Name')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The row shows what the key may do and when it expires.
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('editor');
  await expect(row).toContainText(slug);
  await expect(row).toContainText('Never used');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await expect(row).toContainText(
    expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  );

  // Edit renames it and clears the expiry; the role is read-only.
  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit API key' });
  await expect(edit.getByTestId('key-role')).toHaveText('editor');
  await edit.getByLabel('Name').fill(`${name} renamed`);
  await edit.getByLabel('Expires').selectOption('never');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  const renamed = page.getByRole('row', { name: new RegExp(`${name} renamed`) });
  await expect(renamed).toContainText('Never');

  // Revoke asks first, then the key is listed as revoked with no actions left.
  await renamed.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('dialog', { name: /Revoke/ });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(renamed.getByRole('button', { name: 'Edit' })).toBeVisible();
  await renamed.getByRole('button', { name: 'Revoke' }).click();
  await page
    .getByRole('dialog', { name: /Revoke/ })
    .getByRole('button', { name: 'Revoke key' })
    .click();
  await expect(renamed).toContainText('Revoked');
  await expect(renamed.getByRole('button', { name: 'Edit' })).toBeHidden();
});

test('the create dialog refuses a key with no workspace and an expiry in the past', async ({ page }) => {
  await signIn(page, '/workspaces');
  await createWorkspace(page);
  await page.goto('/api-keys');
  await page.getByRole('button', { name: 'Create key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API key' });

  await dialog.getByLabel('Name').fill(`${name} refused`);
  await dialog.getByRole('button', { name: 'Create key' }).click();
  await expect(dialog.getByText('Pick at least one workspace.')).toBeVisible();

  await dialog.getByRole('checkbox', { name: slug, exact: true }).check();
  await dialog.getByLabel('Expires').selectOption('custom');
  await dialog.getByLabel('Expiry date').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Create key' }).click();
  await expect(dialog.getByText('Pick a date in the future.')).toBeVisible();
});
