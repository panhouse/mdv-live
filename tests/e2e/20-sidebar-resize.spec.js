import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// ResizeHandler (modules/sidebar.js) — 0.6.11 drag-lag fix. The sidebar's
// 0.2s width transition (there for the collapse animation) made every
// drag update ease toward the cursor (owner-reported lag), and each
// mousemove synchronously persisted to localStorage. Contract now:
// transition suspended while dragging (.resizing), width follows the
// cursor, persistence happens ONCE on mouseup.

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-resize-');
  await seedFiles(fixtureDir, { 'doc.md': '# Resize\n\n本文。\n' });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('dragging the handle tracks the cursor with no transition, persists once on mouseup', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  const sidebar = page.locator('#sidebar');
  const handle = page.locator('.resize-handle');

  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(400, box.y + 200, { steps: 5 });

  // Mid-drag: the transition-suspending class is on, and the width is
  // already at (or a frame from) the cursor position.
  await expect(sidebar).toHaveClass(/resizing/);
  await page.waitForTimeout(50); // let the rAF write land
  const midWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(midWidth - 400)).toBeLessThan(8);

  await page.mouse.move(330, box.y + 200, { steps: 3 });
  await page.mouse.up();

  // After mouseup: class removed, final width applied and persisted.
  await expect(sidebar).not.toHaveClass(/resizing/);
  const stored = await page.evaluate(() => localStorage.getItem('mdv-sidebar-width'));
  expect(Number(stored)).toBeGreaterThan(300);
  expect(Number(stored)).toBeLessThan(360);

  // Survives reload at the dragged width. (Wait out the 0.2s width
  // transition that legitimately runs on load — measuring mid-animation
  // reads a transient value.)
  await page.reload();
  await page.waitForTimeout(400);
  const widthAfter = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(widthAfter - Number(stored))).toBeLessThan(8);
});
