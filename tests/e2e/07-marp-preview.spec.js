import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir, buildMarpDeck } from './helpers.js';

let fixtureDir;
let server;
const FILE = 'deck.md';

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-marp-preview-');
  await seedFiles(fixtureDir, {
    [FILE]: buildMarpDeck(['note one', 'note two', 'note three'])
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('marp-preview: opening a Marp deck renders slides and next/prev navigates', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();

  await expect(page.locator('#marpSlideArea')).toBeVisible();
  await expect(page.locator('.marpit')).toBeVisible();

  const slides = page.locator('.marpit > svg[data-marpit-svg]');
  await expect(slides).toHaveCount(3);

  const counter = page.locator('.slide-counter');
  await expect(counter).toHaveText('1 / 3');
  await expect(slides.nth(0)).toHaveClass(/active/);

  await page.locator('.marp-next').click();
  await expect(counter).toHaveText('2 / 3');
  await expect(slides.nth(1)).toHaveClass(/active/);

  await page.locator('.marp-prev').click();
  await expect(counter).toHaveText('1 / 3');
  await expect(slides.nth(0)).toHaveClass(/active/);
});
