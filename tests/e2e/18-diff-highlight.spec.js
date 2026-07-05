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
    const store = JSON.parse(localStorage.getItem('mdv-last-seen') || '{}');
    return store[p] && typeof store[p].hash === 'string';
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
