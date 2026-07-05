import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-open-');
  await seedFiles(fixtureDir, {
    'hello.md': '# Hello World\n\nSome content for the open-file scenario.\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('open-file: clicking a tree node opens it and renders its heading', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await expect(page.locator('.tree-item[data-path="hello.md"] .name')).toBeVisible();
  await page.locator('.tree-item[data-path="hello.md"] [data-action="open"]').click();

  await expect(page.locator('#content h1')).toHaveText('Hello World');
});
