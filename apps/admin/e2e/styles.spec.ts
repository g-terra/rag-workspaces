import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// Unique per run: another worker drives the same stack and the same admin account.
const run = Date.now().toString(36);
const name = `E2E Exam ${run}`;
const slug = `e2e-exam-${run}`;
const workspace = `e2e-${run}-sty`;

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  const ws = await page.request.delete(`/api/v1/workspaces/${workspace}`, { headers });
  expect([204, 404]).toContain(ws.status());
  const style = await page.request.delete(`/api/v1/styles/${slug}`, { headers });
  expect([204, 404]).toContain(style.status());
});

test('an admin creates, edits and deletes a custom style; one in use as a default is kept', async ({
  page,
}) => {
  await signIn(page, '/workspaces');
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Response styles' })
    .click();
  await expect(page.getByRole('heading', { name: 'Response styles', level: 1 })).toBeVisible();
  // The built-in styles are listed, read-only.
  const builtIn = page.getByRole('region', { name: 'Built in' });
  await expect(builtIn.getByTestId('style')).toHaveCount(4);
  await expect(builtIn.getByRole('button', { name: /Edit/ })).toHaveCount(0);

  // The slug follows the name until it is typed.
  await page.getByRole('button', { name: 'New style' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await expect(dialog.getByLabel('Slug')).toHaveValue(slug);
  await dialog.getByLabel('Description').fill('Short revision notes.');
  await dialog.getByLabel('Instructions').fill('Answer in short bullet points.');
  await dialog.getByRole('button', { name: 'Create style' }).click();
  await expect(dialog).toBeHidden();
  const custom = page.getByRole('region', { name: 'Custom' });
  await expect(custom.getByTestId('style').filter({ hasText: name })).toContainText(
    'Answer in short bullet points.',
  );

  await custom.getByRole('button', { name: `Edit ${name}` }).click();
  await expect(dialog.getByLabel('Slug')).toBeDisabled();
  await dialog.getByLabel('Instructions').fill('Answer in three bullet points at most.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(custom.getByTestId('style').filter({ hasText: name })).toContainText('three bullet points');
  // Fields the edit left alone keep their values.
  await expect(custom.getByTestId('style').filter({ hasText: name })).toContainText('Short revision notes.');

  // A workspace that uses it as its default keeps it from being deleted, and the dialog says which.
  const headers = await bearer(page);
  const made = await page.request.post('/api/v1/workspaces', {
    headers,
    data: { slug: workspace, name: `E2E styles ${run}`, settings: { style: slug } },
  });
  expect(made.status()).toBe(201);
  await custom.getByRole('button', { name: `Delete ${name}` }).click();
  await dialog.getByRole('button', { name: 'Delete style' }).click();
  await expect(dialog.getByRole('alert')).toContainText(workspace);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const cleared = await page.request.patch(`/api/v1/workspaces/${workspace}`, {
    headers,
    data: { settings: { style: null } },
  });
  expect(cleared.ok()).toBe(true);
  await custom.getByRole('button', { name: `Delete ${name}` }).click();
  await dialog.getByRole('button', { name: 'Delete style' }).click();
  await expect(dialog).toBeHidden();
  await expect(custom.getByTestId('style').filter({ hasText: name })).toHaveCount(0);
});
