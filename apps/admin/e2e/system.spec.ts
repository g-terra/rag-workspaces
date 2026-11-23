import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

test('the System page shows what the API depends on', async ({ page }) => {
  await signIn(page, '/workspaces');

  // The admin nav leads to it.
  // Scoped to the sidebar: the banner shows a link to the same page whenever something is down.
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'System' }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole('heading', { name: 'System', exact: true })).toBeVisible();

  // Every service the API checks is listed, and so is where its Langflow key came from.
  const status = await page.request.get('/api/v1/system', { headers: await bearer(page) });
  expect(status.ok()).toBe(true);
  const system = (await status.json()) as {
    status: string;
    version: string;
    services: { name: string }[];
    providers: { id: string }[];
  };
  for (const service of system.services) {
    await expect(page.getByText(service.name, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText('Langflow key')).toBeVisible();
  await expect(page.getByText(system.version, { exact: true })).toBeVisible();
  await expect(page.getByText('Default chat', { exact: true })).toBeVisible();

  // Every provider is listed, including those with no key set — that is why they offer nothing.
  expect(system.providers.length).toBeGreaterThan(0);
  await expect(page.getByText('No key').first()).toBeVisible();

  // Asking again is one request, not a reload.
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
});

test('a degraded system is called out above every page, with what to do', async ({ page }) => {
  await signIn(page, '/workspaces');
  const status = await page.request.get('/api/v1/system', { headers: await bearer(page) });
  const system = (await status.json()) as { status: string };

  // The smoke stack's default chat model is not one the stand-in serves, so it is degraded; an
  // install where everything is available shows no banner, which is the other half of the contract.
  const banner = page.getByRole('alert').filter({ hasText: /isn't answering|is not available|not healthy/ });
  if (system.status === 'degraded') {
    await expect(banner).toBeVisible();
    // It says what to do, not only what is wrong, and leads to the detail.
    await expect(banner.getByRole('link', { name: 'System' })).toBeVisible();
    // It is above every page, not only this one.
    await page.goto('/api-keys');
    await expect(
      page.getByRole('alert').filter({ hasText: /isn't answering|is not available/ }),
    ).toBeVisible();
  } else {
    await expect(banner).toHaveCount(0);
    await page.goto('/system');
    await expect(page.getByText(/Everything the API depends on answered/)).toBeVisible();
  }
});
