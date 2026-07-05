import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-boot-');
  await seedFiles(fixtureDir, {
    'README.md': '# Boot Test\n\nHello from the boot fixture.\n',
    'notes.txt': 'plain text sidecar file\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('boot: page loads and file tree renders seeded entries', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  // The shell renders.
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#content')).toBeVisible();

  // Seeded files show up in the tree.
  await expect(page.locator('.tree-item[data-path="README.md"] .name')).toHaveText('README.md');
  await expect(page.locator('.tree-item[data-path="notes.txt"] .name')).toHaveText('notes.txt');
});
