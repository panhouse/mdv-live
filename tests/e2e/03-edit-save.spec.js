import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;
const FILE = 'draft.md';

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-edit-');
  await seedFiles(fixtureDir, {
    [FILE]: '# Draft\n\nOriginal text.\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('edit-save: toggling edit mode, typing, and saving persists to disk', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Draft');

  // Toggle edit mode via Cmd+E (macOS Chromium uses the Meta modifier).
  await page.keyboard.press('ControlOrMeta+e');
  const textarea = page.locator('#editorTextarea');
  await expect(textarea).toBeVisible();

  const newContent = '# Draft\n\nUpdated text via e2e test.\n';
  await textarea.fill(newContent);

  // Save via Cmd+S and wait for the toolbar to confirm the write.
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#editorStatus')).toHaveText('Saved!', { timeout: 5000 });

  // The file on disk actually contains the new text.
  const onDisk = await readFile(path.join(fixtureDir, FILE), 'utf-8');
  expect(onDisk).toContain('Updated text via e2e test.');
});
