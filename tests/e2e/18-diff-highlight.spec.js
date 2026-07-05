import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// modules/diffReview.js — 0.6.4 ハイライト + ジャンプ. Covers the full
// baseline lifecycle: first open silently records a baseline (no toolbar
// controls), a later external edit is detected via the live file_update ->
// GET /api/diff round trip and rendered as the toolbar's 「変更 N」/「✓ 確認」
// buttons + block highlights (0.6.8: the old standalone #diffReviewBar band
// is gone, see toggleBtn/confirmBtn below), the highlight toggle and ⌥↑↓
// jump both work, and the localStorage baseline (STORAGE_KEYS.LAST_SEEN,
// 'mdv-last-seen') survives reload whether or not the user confirmed it.

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

test('diff review: no toolbar controls on first open; a live edit shows them + highlights; toggle/jump work; the baseline survives reload (confirmed and not)', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');

  // 0.6.8 Word-like declutter (owner): the old #diffReviewBar 3rd band is
  // gone — the toolbar's #diffToggleBtn/#diffConfirmBtn replace it.
  const toggleBtn = page.locator('#diffToggleBtn');
  const confirmBtn = page.locator('#diffConfirmBtn');

  // (a) First-ever open: no prior baseline -> silently recorded, no
  // toolbar controls.
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
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

  // The toolbar controls appear with the right count once the live
  // file_update triggers modules/diffReview.js's re-check against the
  // recorded baseline (0.6.8 Word-like declutter (owner): was the bar's
  // 「N箇所変更されました」 summary, now the 「変更 N」 button label).
  await expect(toggleBtn).toBeVisible({ timeout: 3000 });
  await expect(toggleBtn).toHaveText('変更 2');
  await expect(confirmBtn).toBeVisible();

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

  // (b) Toggle hides highlights but keeps the toolbar button visible
  // (pressed -> off). 0.6.8 Word-like declutter (owner): click the
  // toolbar's 「変更 N」 button instead of the old in-bar #diffHighlightToggle.
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  await toggleBtn.click();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(toggleBtn).toBeVisible();

  // Toggling back on re-applies them from the already-fetched diff (no
  // re-fetch needed).
  await toggleBtn.click();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(2);
  await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');

  // (c) ⌥↑↓ scrolls a highlighted block into view (and briefly flashes it).
  // Cycling in document order, the first ⌥↓ from no selection lands on the
  // changed block (line 5), which precedes the added block (line 9).
  // 0.6.8 Word-like declutter (owner): the jump shortcut itself is
  // untouched by the bar removal — only the surrounding UI moved.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(changedBlock).toBeInViewport();
  await expect(changedBlock).toHaveClass(/diff-jump-flash/);
  // The flash class is temporary (~DIFF_JUMP_FLASH_MS) — it must clear on
  // its own without disturbing the persistent diff-changed highlight.
  await expect(changedBlock).not.toHaveClass(/diff-jump-flash/, { timeout: 3000 });
  await expect(changedBlock).toHaveClass(/diff-changed/);

  // (e) Reload WITHOUT confirming: the localStorage baseline (recorded on
  // first open, still older than the on-disk edit) survives the reload, so
  // the toolbar controls are recomputed and reappear.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(toggleBtn).toBeVisible({ timeout: 3000 });
  await expect(toggleBtn).toHaveText('変更 2');

  // (d) 「✓ 確認」 clears the toolbar controls/highlights and updates the
  // stored baseline hash to the current content. 0.6.8 Word-like declutter
  // (owner): same action as the old in-bar 「最新を確認済みにする」, now a
  // plain toolbar button.
  await confirmBtn.click();
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);

  // Persists: reloading again now shows no toolbar controls, since the
  // stored baseline matches the current (still-EDITED) content.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(toggleBtn).toBeHidden();
});

test('toolbar diff controls disappear when the last tab is closed (welcome view)', async ({ page }) => {
  const p = 'closeme.md';
  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n');
  await page.goto(server.baseURL + '/');
  await expect(page.locator(`.tree-item[data-path="${p}"] .name`)).toBeVisible();
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Close Me');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n\n追記の段落。\n');
  // 0.6.8 Word-like declutter (owner): the toolbar's #diffToggleBtn
  // replaces the old #diffReviewBar for this visibility check.
  await expect(page.locator('#diffToggleBtn')).toBeVisible({ timeout: 6000 });

  // Close the last tab -> welcome view; the controls must not linger (codex).
  await page.locator('#tabBar .tab .tab-close').click();
  await expect(page.locator('#content .welcome')).toBeVisible();
  await expect(page.locator('#diffToggleBtn')).toBeHidden();
  await expect(page.locator('#diffConfirmBtn')).toBeHidden();
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

  // 0.6.8 Word-like declutter (owner): toolbar button replaces the old bar.
  await expect(page.locator('#diffToggleBtn')).toBeVisible({ timeout: 3000 });

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
  // 0.6.8 Word-like declutter (owner): the toolbar's 「変更 N」 button
  // replaces the bar; the regression this guards against showed the
  // unknown-baseline label (「変更 ?」) here instead of a real count.
  const toggleBtn = page.locator('#diffToggleBtn');
  await expect(toggleBtn).toBeVisible({ timeout: 6000 });
  await expect(toggleBtn).toHaveText(/^変更 \d+$/);
  await expect(toggleBtn).not.toHaveText('変更 ?');
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
  // With the bug, A's hash mismatches B's content -> spurious toolbar
  // controls. 0.6.8 Word-like declutter (owner): toolbar button replaces
  // the bar for this assertion.
  await expect(page.locator('#diffToggleBtn')).toBeHidden();
  await page.goto('about:blank');
  await serverB.stop();
  await removeFixtureDir(rootA);
  await removeFixtureDir(rootB);
  // Restart the shared suite server so later tests in this file (if any
  // are added) and afterAll teardown find a live instance.
  server = await startServer(fixtureDir, { port: portToReuse });
});
