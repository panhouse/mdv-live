import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-external-tree-');
  await seedFiles(fixtureDir, {
    'existing.md': '# Existing\n\nBaseline file.\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('external-tree-change: a new file added on disk appears in the tree', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await expect(page.locator('.tree-item[data-path="existing.md"]')).toBeVisible();
  await expect(page.locator('.tree-item[data-path="brand-new.md"]')).toHaveCount(0);

  await writeFile(
    path.join(fixtureDir, 'brand-new.md'),
    '# Brand New\n\nAdded after boot.\n',
    'utf-8'
  );

  // tree_update is debounced 150ms server-side, then the client's own
  // scheduleRefresh coalesces with another 50ms window.
  await expect(page.locator('.tree-item[data-path="brand-new.md"] .name')).toHaveText(
    'brand-new.md',
    { timeout: 3000 }
  );
});
