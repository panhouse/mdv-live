import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir, buildMarpDeck } from './helpers.js';

let fixtureDir;
let server;
const FILE = 'deck.md';

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-inline-notes-');
  await seedFiles(fixtureDir, {
    [FILE]: buildMarpDeck(['note one', 'note two'])
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('inline-notes: editing a speaker note autosaves to disk inside an HTML comment', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#marpSlideArea')).toBeVisible();

  const editor = page.locator('.speaker-notes-panel[data-slide-index="0"] [data-role="editor"]');
  await expect(editor).toHaveText('note one');
  await expect(editor).toHaveAttribute('contenteditable', 'true');

  await editor.click();
  // Select-all via the DOM Selection API: Meta+A is macOS-only and
  // Control+A is Linux/Windows-only — a modifier-keyed select-all makes
  // this spec pass locally (mac) and fail in CI (ubuntu) or vice versa.
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Updated note text for slide one');

  const status = page.locator('.speaker-notes-panel[data-slide-index="0"] [data-role="status"]');
  // NOTES_AUTOSAVE_DEBOUNCE_MS is 800ms; give it room plus a round trip.
  await expect(status).toHaveText('保存済み', { timeout: 5000 });

  await expect.poll(
    async () => readFile(path.join(fixtureDir, FILE), 'utf-8'),
    { timeout: 5000 }
  ).toContain('<!-- Updated note text for slide one -->');
});
