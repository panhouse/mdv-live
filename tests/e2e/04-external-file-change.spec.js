import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;
const FILE = 'live.md';

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-external-file-');
  await seedFiles(fixtureDir, {
    [FILE]: '# Live\n\nOriginal paragraph.\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('external-file-change: a disk rewrite while the file is open updates the rendered content via WebSocket', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#content')).toContainText('Original paragraph.');

  // Rewrite the file on disk while it is the active tab. chokidar's
  // awaitWriteFinish (stabilityThreshold 100ms, pollInterval 50ms) plus the
  // watcher's own processing add latency before the WebSocket file_update
  // frame arrives, so poll instead of asserting immediately.
  await writeFile(
    path.join(fixtureDir, FILE),
    '# Live\n\nExternally updated paragraph.\n',
    'utf-8'
  );

  await expect(page.locator('#content')).toContainText('Externally updated paragraph.', {
    timeout: 3000
  });
});
