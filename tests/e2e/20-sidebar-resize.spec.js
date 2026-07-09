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
  await seedFiles(fixtureDir, {
    'doc.md': '# Resize\n\n本文。\n',
    // For the iframe-continuation test below (0.6.15): an .html file
    // renders via ContentRenderer.renderHTML() into an <iframe> that fills
    // most of #content, the exact surface the old mousemove-based drag
    // died on when the cursor crossed into it.
    'preview.html': '<!doctype html><html><body><p>Preview</p></body></html>\n'
  });
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

test('a drag released in the collapse zone still remembers the last expanded width (codex)', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  const handle = page.locator('.resize-handle');
  const box = await handle.boundingBox();

  const before = await page.evaluate(() => localStorage.getItem('mdv-sidebar-width'));

  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(420, box.y + 200, { steps: 4 }); // 開いた幅を経由して
  await page.mouse.move(20, box.y + 200, { steps: 8 });  // 畳みゾーンで離す
  await page.mouse.up();

  await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  const stored = await page.evaluate(() => localStorage.getItem('mdv-sidebar-width'));
  // このドラッグで経由した「最後の展開幅」（畳み境界の直前に通った値）が
  // 保存されている — ドラッグ前の値のままではなく、かつ有効な展開幅
  expect(Number(stored)).toBeGreaterThanOrEqual(50);
  expect(stored).not.toBe(before);
});

// 0.6.15: Pointer Events + setPointerCapture rebuild (owner: "重い / 持ち
// づらい / 途中でとまったりする"). The tests below characterize the new
// contract — the three existing tests above are untouched and must keep
// passing unmodified (page.mouse fires pointer events too, so they exercise
// the new pointerdown/pointermove/pointerup path transparently).

test('drag keeps tracking while the cursor is over an iframe preview, and cleanup/persist still fire on release there', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator('.tree-item[data-path="preview.html"] [data-action="open"]').click();

  const iframe = page.locator('.html-preview iframe');
  await expect(iframe).toBeVisible();
  const iframeBox = await iframe.boundingBox();

  const sidebar = page.locator('#sidebar');
  const handle = page.locator('.resize-handle');
  const handleBox = await handle.boundingBox();

  // Test points deliberately stay under SIDEBAR_MAX_WIDTH (500) — the max
  // clamp is covered separately below — while still landing inside the
  // iframe's own bounding box, so this really exercises "cursor over the
  // iframe", not just "cursor over blank content pane".
  const midX = 350;
  const laterX = 420;
  expect(midX).toBeGreaterThanOrEqual(iframeBox.x);
  expect(laterX).toBeLessThanOrEqual(iframeBox.x + iframeBox.width);

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 20);
  await page.mouse.down();

  // Old behavior: the document-level mousemove listener got handed to the
  // iframe's own document the moment the cursor crossed into it, and the
  // drag silently died (owner: "途中でとまったりする"). setPointerCapture
  // keeps every subsequent pointer event routed to the handle regardless.
  await page.mouse.move(midX, handleBox.y + 20, { steps: 8 });
  await page.waitForTimeout(50);
  const midWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(midWidth - midX)).toBeLessThan(10);

  await page.mouse.move(laterX, handleBox.y + 20, { steps: 5 });
  await page.waitForTimeout(50);
  const laterWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(laterWidth).toBeGreaterThan(midWidth);

  // Release WHILE still positioned over the iframe.
  await page.mouse.up();

  await expect(sidebar).not.toHaveClass(/resizing/);
  await expect(page.locator('body')).not.toHaveClass(/sidebar-dragging/);
  const stored = await page.evaluate(() => localStorage.getItem('mdv-sidebar-width'));
  expect(Math.abs(Number(stored) - laterWidth)).toBeLessThan(5);
});

test('dragging past the max width clamps and keeps tracking; returning inside the range responds immediately', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  const sidebar = page.locator('#sidebar');
  const handle = page.locator('.resize-handle');
  const box = await handle.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();

  // Old code: `if (clientX < 0 || clientX > 500) return;` simply stopped
  // tracking past the bound, which read as the drag being "broken". Clamp
  // instead — the sidebar should pin at the max and keep following.
  await page.mouse.move(700, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);
  let width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(500);

  // Further overshoot (700 -> 900) stays pinned rather than getting stuck.
  await page.mouse.move(900, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);
  width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(500);

  // Coming back inside the range responds immediately — proof the drag
  // never actually detached while pinned at the max.
  await page.mouse.move(400, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);
  width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(width - 400)).toBeLessThan(8);

  await page.mouse.up();
});

test('a drag can start just outside the visible 6px bar, inside the widened hit-area', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  const sidebar = page.locator('#sidebar');
  const handle = page.locator('.resize-handle');
  const box = await handle.boundingBox();

  // box.width is the visible 6px bar. +3px lands outside it but well
  // inside the ::after hit-area extension (14px wide, 4px past each
  // edge) — kept a pixel short of the exact +4px boundary to avoid
  // sub-pixel edge flakiness in the hit-test.
  const startX = box.x + box.width + 3;
  await page.mouse.move(startX, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(startX + 60, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);

  await expect(sidebar).toHaveClass(/resizing/);
  const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(box.width);

  await page.mouse.up();
  await expect(sidebar).not.toHaveClass(/resizing/);
});

test('a synthetic pointercancel cleans up drag state (real input cannot reproduce this path)', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  const sidebar = page.locator('#sidebar');
  const handle = page.locator('.resize-handle');
  const box = await handle.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(400, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);
  await expect(sidebar).toHaveClass(/resizing/);

  // page.mouse cannot produce a real pointercancel (browsers only fire it
  // for things like a touch drag being taken over by scroll, or a stylus
  // hovering out of range) — this is a synthetic-event test dispatching
  // one directly, to exercise the cleanup branch that pointerup/blur don't
  // cover. Not a substitute for the real-input tests above.
  await handle.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true }));
  });

  await expect(sidebar).not.toHaveClass(/resizing/);
  await expect(page.locator('body')).not.toHaveClass(/sidebar-dragging/);

  // state.isResizing isn't exposed on window; the externally-observable
  // proxy is that width tracking has actually stopped, not just that the
  // CSS classes were removed.
  const widthAfterCancel = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(250, box.y + 200, { steps: 5 });
  await page.waitForTimeout(50);
  const widthAfterStaleMove = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(widthAfterStaleMove).toBe(widthAfterCancel);

  await page.mouse.up();
});
