import { expect, test, type Page } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

// Unique per run: another worker drives the same stack and the same admin account.
const run = Date.now().toString(36);
const made: string[] = [];

async function createWorkspace(page: Page, suffix: string) {
  const slug = `e2e-${run}-${suffix}`;
  made.push(slug);
  const res = await page.request.post('/api/v1/workspaces', {
    headers: await bearer(page),
    data: { slug, name: `E2E ${suffix} ${run}`, description: 'Made by the Playwright test' },
  });
  expect(res.status()).toBe(201);
  return slug;
}

test.afterEach(async ({ page }) => {
  const headers = await bearer(page);
  for (const workspace of made.splice(0)) {
    const res = await page.request.delete(`/api/v1/workspaces/${workspace}`, { headers });
    expect([204, 404]).toContain(res.status());
  }
});

test('the picker marks people who already have access rather than hiding them', async ({ page }) => {
  await signIn(page, '/workspaces');
  const slug = await createWorkspace(page, 'picker');
  await page.goto(`/w/${slug}/settings`);

  // A new workspace has no members: admins reach it without being listed.
  await expect(page.getByText(/Nobody has been granted access yet/)).toBeVisible();

  // The signed-in admin is in the directory and offered, marked and unselectable — the answer to
  // "why isn't this person in the list?" that leaving them out would not give.
  const person = page.getByLabel('Person to grant');
  await expect(person).toBeVisible();
  const covered = person.locator('option', { hasText: 'an admin, so already has access' }).first();
  await expect(covered).toBeAttached();
  await expect(covered).toHaveJSProperty('disabled', true);

  // Nothing is grantable until a person is chosen.
  await expect(page.getByRole('button', { name: 'Grant access' })).toBeDisabled();
});

test('an admin changes a member’s role and removes it', async ({ page }) => {
  await signIn(page, '/workspaces');
  const slug = await createWorkspace(page, 'members');

  // Granted through the API: `PUT .../members/{userId}` takes any Keycloak id, signed in or not, so
  // this also covers the row for a member the directory cannot name.
  const userId = `e2e-absent-${run}`;
  const granted = await page.request.put(`/api/v1/workspaces/${slug}/members/${userId}`, {
    headers: await bearer(page),
    data: { role: 'editor' },
  });
  expect(granted.status()).toBe(200);

  await page.goto(`/w/${slug}/settings`);
  await expect(page.getByText(/not in the directory/)).toBeVisible();

  const roleSelect = page.getByLabel(`Role for ${userId}`);
  await expect(roleSelect).toHaveValue('editor');

  // Changing the role is the same PUT, and the list reloads with the new one.
  await roleSelect.selectOption('reader');
  await expect(page.getByLabel(`Role for ${userId}`)).toHaveValue('reader');
  await page.reload();
  await expect(page.getByLabel(`Role for ${userId}`)).toHaveValue('reader');

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(/Nobody has been granted access yet/)).toBeVisible();
});

test('an admin deletes a workspace after typing its slug', async ({ page }) => {
  await signIn(page, '/workspaces');
  const slug = await createWorkspace(page, 'doomed');
  await page.goto(`/w/${slug}/settings`);

  await page.getByRole('button', { name: 'Delete workspace…' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Delete workspace' });

  // Nothing happens until the slug is typed exactly.
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Type ${slug} to confirm`).fill(slug.toUpperCase());
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Type ${slug} to confirm`).fill(slug);
  await expect(confirm).toBeEnabled();

  await confirm.click();

  // It lands on the list, and the workspace is gone from it and from the API.
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(page.getByText(slug, { exact: true })).toHaveCount(0);
  const gone = await page.request.get(`/api/v1/workspaces/${slug}`, { headers: await bearer(page) });
  expect(gone.status()).toBe(404);
  made.length = 0;
});
