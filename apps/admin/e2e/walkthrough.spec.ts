import { expect, test } from '@playwright/test';
import { bearer, requireCredentials, signIn } from './sign-in';

requireCredentials();

const slug = `e2e-${Date.now().toString(36)}-tour`;

test.afterEach(async ({ page }) => {
  const res = await page.request.delete(`/api/v1/workspaces/${slug}`, { headers: await bearer(page) });
  expect([204, 404]).toContain(res.status());
});

test('opens on first sign-in, is remembered once skipped, and replays from Help', async ({ page }) => {
  await signIn(page, '/workspaces', { skipTour: false });

  // First sign-in in this browser: the welcome opens by itself.
  const welcome = page.getByRole('dialog', { name: 'Welcome to rag-workspaces' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Next' }).click();

  // The next step points at the workspace switcher and outlines it.
  await expect(page.getByRole('dialog', { name: 'Your workspaces' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toHaveAttribute(
    'data-tour-active',
    '',
  );
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-tour-active]')).toHaveCount(0);

  // Skipped is remembered.
  await page.reload();
  await page.getByTestId('user-role').getByText('admin').waitFor();
  await expect(page.getByRole('dialog', { name: 'Welcome to rag-workspaces' })).toHaveCount(0);

  // Inside a workspace, Help replays it with the workspace's own pages, through to Done on Help.
  const res = await page.request.post('/api/v1/workspaces', {
    headers: await bearer(page),
    data: { name: 'E2E Tour', slug },
  });
  expect(res.status()).toBe(201);
  await page.goto(`/w/${slug}`);
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('button', { name: 'Show the walkthrough' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to rag-workspaces' })).toBeVisible();
  const titles: string[] = [];
  for (;;) {
    const step = page.getByRole('dialog');
    const done = step.getByRole('button', { name: 'Done' });
    if (await done.isVisible()) {
      titles.push((await step.getByRole('heading').textContent()) ?? '');
      await done.click();
      break;
    }
    const heading = step.getByRole('heading');
    titles.push((await heading.count()) ? ((await heading.textContent()) ?? '') : 'Welcome');
    await step.getByRole('button', { name: 'Next' }).click();
  }
  expect(titles).toEqual(
    expect.arrayContaining(['Upload material', 'Playground', 'API keys', 'Help is here']),
  );
  expect(titles.at(-1)).toBe('Help is here');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
