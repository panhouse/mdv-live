import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-tabs-');
  await seedFiles(fixtureDir, {
    'tab-one.md': '# One\n\nFirst file.\n',
    'tab-two.md': '# Two\n\nSecond file.\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('tabs: opening two files creates two tabs; switching and closing behave correctly', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await page.locator('.tree-item[data-path="tab-one.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('One');

  await page.locator('.tree-item[data-path="tab-two.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('Two');

  const tabs = page.locator('#tabBar .tab');
  await expect(tabs).toHaveCount(2);

  const tabOne = tabs.filter({ hasText: 'tab-one.md' });
  const tabTwo = tabs.filter({ hasText: 'tab-two.md' });
  await expect(tabOne).toBeVisible();
  await expect(tabTwo).toBeVisible();
  await expect(tabTwo).toHaveClass(/active/);

  // Switch back to the first tab.
  await tabOne.click();
  await expect(tabOne).toHaveClass(/active/);
  await expect(page.locator('#content h1')).toHaveText('One');

  // Close the first (currently active) tab; the second should take over.
  await tabOne.locator('.tab-close').click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveClass(/active/);
  await expect(tabs.first()).toContainText('tab-two.md');
  await expect(page.locator('#content h1')).toHaveText('Two');
});
