import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// modules/diffReview.js — 0.6.4 差分バー + ハイライト + ジャンプ. Covers the
// full baseline lifecycle: first open silently records a baseline (no
// bar), a later external edit is detected via the live file_update ->
// GET /api/diff round trip and rendered as a bar + block highlights,
// the highlight toggle and ⌥↑↓ jump both work, and the localStorage
// baseline (STORAGE_KEYS.LAST_SEEN, 'mdv-last-seen') survives reload
// whether or not the user confirmed it.

let fixtureDir;
let server;

/**
 * Baseline capture is async (first-sight /api/diff round trip) — poll the
 * namespaced localStorage entry instead of sleeping a fixed interval
 * (fixed sleeps race on slow CI; codex round-12).
 */
async function waitForBaseline(page, p) {
  await expect.poll(() => page.evaluate((rel) => {
    const store = JSON.parse(localStorage.getItem('mdv-last-seen') || '{}');
    const key = Object.keys(store).find((k) => k.endsWith('\u0000' + rel));
    return !!key && typeof store[key].hash === 'string';
  }, p), { timeout: 5000 }).toBe(true);
}

const FILE = 'review.md';

const ORIGINAL = [
  '# Review Doc',
  '',
  'Paragraph one stays the same.',
  '',
  'Paragraph two will change.',
  '',
  'Paragraph three stays too.'
].join('\n') + '\n';

const EDITED = [
  '# Review Doc',
  '',
  'Paragraph one stays the same.',
  '',
  'Paragraph two has changed now.',
  '',
  'Paragraph three stays too.',
  '',
  'New appended line one.',
  'New appended line two.'
].join('\n') + '\n';

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-diff-');
  await seedFiles(fixtureDir, { [FILE]: ORIGINAL });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('diff review: no bar on first open; a live edit shows the bar + highlights; toggle/jump work; the baseline survives reload (confirmed and not)', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');

  const bar = page.locator('#diffReviewBar');

  // (a) First-ever open: no prior baseline -> silently recorded, no bar.
  await expect(bar).toBeHidden();
  await expect.poll(() => page.evaluate((p) => {
    // Keys are namespaced rootPath + NUL + path (cross-project isolation)
    // - match by suffix.
    const store = JSON.parse(localStorage.getItem('mdv-last-seen') || '{}');
    const key = Object.keys(store).find((k) => k.endsWith('\u0000' + p));
    return !!key && typeof store[key].hash === 'string';
  }, FILE)).toBe(true);

  // Rewrite the file on disk while it's the active/watched tab. chokidar's
  // awaitWriteFinish adds latency before file_update arrives (see
  // 04-external-file-change.spec.js) — poll instead of asserting immediately.
  await writeFile(path.join(fixtureDir, FILE), EDITED, 'utf-8');
  await expect(page.locator('#content')).toContainText('Paragraph two has changed now.', { timeout: 3000 });

  // The bar appears with the right summary/count once the live file_update
  // triggers modules/diffReview.js's re-check against the recorded baseline.
  await expect(bar).toBeVisible({ timeout: 3000 });
  await expect(bar).toContainText('変更されました');
  await expect(bar.locator('.diff-bar-count')).toHaveText('2箇所');

  // Highlights: the changed paragraph and the newly-appended block.
  const changedBlock = page.locator('#content [data-source-line].diff-changed', {
    hasText: 'Paragraph two has changed now.'
  });
  const addedBlock = page.locator('#content [data-source-line].diff-added', {
    hasText: 'New appended line one.'
  });
  await expect(changedBlock).toBeVisible();
  await expect(addedBlock).toBeVisible();
  // Untouched paragraphs must not be flagged.
  await expect(page.locator('#content [data-source-line]', { hasText: 'Paragraph one stays the same.' }))
    .not.toHaveClass(/diff-added|diff-changed/);

  // (b) Toggle hides highlights but keeps the bar.
  await page.locator('#diffHighlightToggle').click();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(bar).toBeVisible();

  // Toggling back on re-applies them from the already-fetched diff (no
  // re-fetch needed).
  await page.locator('#diffHighlightToggle').click();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(2);

  // (c) ⌥↑↓ scrolls a highlighted block into view (and briefly flashes it).
  // Cycling in document order, the first ⌥↓ from no selection lands on the
  // changed block (line 5), which precedes the added block (line 9).
  await page.keyboard.press('Alt+ArrowDown');
  await expect(changedBlock).toBeInViewport();
  await expect(changedBlock).toHaveClass(/diff-jump-flash/);
  // The flash class is temporary (~DIFF_JUMP_FLASH_MS) — it must clear on
  // its own without disturbing the persistent diff-changed highlight.
  await expect(changedBlock).not.toHaveClass(/diff-jump-flash/, { timeout: 3000 });
  await expect(changedBlock).toHaveClass(/diff-changed/);

  // (e) Reload WITHOUT confirming: the localStorage baseline (recorded on
  // first open, still older than the on-disk edit) survives the reload, so
  // the bar is recomputed and reappears.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(bar).toBeVisible({ timeout: 3000 });
  await expect(bar.locator('.diff-bar-count')).toHaveText('2箇所');

  // (d) 「最新を確認済みにする」 clears the bar/highlights and updates the
  // stored baseline hash to the current content.
  await page.locator('#diffConfirmBtn').click();
  await expect(bar).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);

  // Persists: reloading again now shows no bar, since the stored baseline
  // matches the current (still-EDITED) content.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(bar).toBeHidden();
});

test('diff bar disappears when the last tab is closed (welcome view)', async ({ page }) => {
  const p = 'closeme.md';
  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n');
  await page.goto(server.baseURL + '/');
  await expect(page.locator(`.tree-item[data-path="${p}"] .name`)).toBeVisible();
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Close Me');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n\n追記の段落。\n');
  await expect(page.locator('#diffReviewBar')).toBeVisible({ timeout: 6000 });

  // Close the last tab -> welcome view; the bar must not linger (codex).
  await page.locator('#tabBar .tab .tab-close').click();
  await expect(page.locator('#content .welcome')).toBeVisible();
  await expect(page.locator('#diffReviewBar')).toBeHidden();
});

test('diff review: a TIGHT LIST bullet change highlights the <li> itself, not the preceding heading (0.6.6 list-item mapping)', async ({ page }) => {
  const p = 'bullets.md';
  const original = [
    '# 議事録',
    '',
    '- 決定事項A',
    '- 決定事項B',
    '- 決定事項C'
  ].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), original);
  await page.goto(server.baseURL + '/');
  await expect(page.locator(`.tree-item[data-path="${p}"] .name`)).toBeVisible();
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('議事録');
  await waitForBaseline(page, p);

  // Externally edit ONLY the middle bullet — this is a tight list (no blank
  // lines between items), the exact case that used to have no
  // data-source-line anywhere inside the <li> and so fell back to
  // highlighting the nearest preceding block (the <h1>) instead.
  const edited = [
    '# 議事録',
    '',
    '- 決定事項A',
    '- 決定事項Bを修正した',
    '- 決定事項C'
  ].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), edited);
  await expect(page.locator('#content')).toContainText('決定事項Bを修正した', { timeout: 3000 });

  const bar = page.locator('#diffReviewBar');
  await expect(bar).toBeVisible({ timeout: 3000 });

  // The changed bullet's own <li> gets .diff-changed directly (pass 1 of
  // diffReview.js's range-intersection match) — not the <h1>, which would
  // only happen via the nearest-preceding-block fallback (pass 2).
  const changedLi = page.locator('#content li.diff-changed');
  await expect(changedLi).toHaveCount(1);
  await expect(changedLi).toContainText('決定事項Bを修正した');
  await expect(page.locator('#content h1')).not.toHaveClass(/diff-changed/);
  // The untouched sibling bullets must not be flagged either.
  await expect(page.locator('#content li', { hasText: '決定事項A' })).not.toHaveClass(/diff-changed/);
  await expect(page.locator('#content li', { hasText: '決定事項C' })).not.toHaveClass(/diff-changed/);
});

test('Marp decks get real change counts (baseline seeded on first sight, codex)', async ({ page }) => {
  const p = 'seeded-deck.md';
  const deck = '---\nmarp: true\n---\n\n# 一枚目\n\n<!-- note -->\n';
  await writeFile(path.join(fixtureDir, p), deck);
  await page.goto(server.baseURL + '/');
  await expect(page.locator(`.tree-item[data-path="${p}"] .name`)).toBeVisible();
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#marpSlideArea, .marpit').first()).toBeVisible();
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), deck + '\n---\n\n# 追加スライド\n');
  const bar = page.locator('#diffReviewBar');
  await expect(bar).toBeVisible({ timeout: 6000 });
  // The regression showed 「差分は取得できませんでした」 here; a seeded
  // baseline yields a real change count instead.
  await expect(bar).toContainText('変更されました');
  await expect(bar).not.toContainText('取得できませんでした');
});

test('baselines are namespaced by served root (no cross-project bleed)', async ({ page }) => {
  // Same origin (port) + same relative path, DIFFERENT roots: project B
  // must not inherit project A's baseline (codex round-4).
  const portToReuse = server.port;
  const rootA = await makeFixtureDir('mdv-e2e-rootA-');
  await seedFiles(rootA, { 'shared.md': '# Project A\n\nAの本文。\n' });
  // Detach the page's live WebSocket BEFORE stopping a server —
  // server.close() waits for open connections and hangs otherwise.
  await page.goto('about:blank');
  await server.stop();
  const serverA = await startServer(rootA, { port: portToReuse });
  // NOTE: the helper's baseURL reflects its own free-port pick, not the
  // serverOptions.port override - address the reused port directly.
  const base = `http://localhost:${portToReuse}`;
  await page.goto(base + '/');
  await page.locator('.tree-item[data-path="shared.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('Project A');
  await waitForBaseline(page, 'shared.md');
  await page.goto('about:blank');
  await serverA.stop();

  const rootB = await makeFixtureDir('mdv-e2e-rootB-');
  await seedFiles(rootB, { 'shared.md': '# Project B\n\nBの本文はまったく別物。\n' });
  const serverB = await startServer(rootB, { port: portToReuse });
  await page.goto(base + '/');
  await page.locator('.tree-item[data-path="shared.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('Project B');
  await page.waitForTimeout(700);
  // With the bug, A's hash mismatches B's content -> spurious bar.
  await expect(page.locator('#diffReviewBar')).toBeHidden();
  await page.goto('about:blank');
  await serverB.stop();
  await removeFixtureDir(rootA);
  await removeFixtureDir(rootB);
  // Restart the shared suite server so later tests in this file (if any
  // are added) and afterAll teardown find a live instance.
  server = await startServer(fixtureDir, { port: portToReuse });
});
