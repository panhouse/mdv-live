import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';
import { JOURNAL_MAX_VERSIONS_PER_FILE } from '../../src/config/constants.js';

// modules/diffReview.js — 0.6.4 ハイライト + ジャンプ. Covers the full
// baseline lifecycle: first open silently records a baseline (no toolbar
// controls), a later external edit is detected via the live file_update ->
// GET /api/diff round trip and rendered as the toolbar's 「次の変更 N」/
// 「✓ 確認」 buttons + block highlights (0.6.8: the old standalone
// #diffReviewBar band is gone, see toggleBtn/confirmBtn below), ⌥↑↓ jump
// works, and the localStorage baseline (STORAGE_KEYS.LAST_SEEN,
// 'mdv-last-seen') survives reload whether or not the user confirmed it.
//
// 0.6.12 unified review mode (owner): Word's 校閲/Review tab mental model —
// ONE permanent toolbar button (`#reviewModeToggle`, label "Review") now
// gates the ENTIRE review surface, superseding 0.6.10's independent
// highlight sub-toggle. Every test below that used to click `#diffToggleBtn`
// to turn markup ON now clicks `#reviewModeToggle` instead — `#diffToggleBtn`
// itself no longer toggles anything; clicking it JUMPS to the next change
// (same as ⌥↓), and it (plus `#diffConfirmBtn`) is only ever HIDDEN while
// Review mode is OFF. Every Playwright test gets a fresh browser context (no
// localStorage carried over), so "fresh profile, Review defaults OFF" needs
// no special setup — it's just the ambient state.
//
// 0.6.14 (owner: labels/placement/layout jitter) — while Review mode is ON,
// both buttons now stay permanently MOUNTED (never `.hidden`) even with no
// pending diff to review; "nothing to act on" is expressed via the
// `disabled` attribute instead, so the toolbar never reflows on tab switch/
// diff-resolve. Every assertion below that used to expect `toBeHidden()`
// for these buttons while Review is ON with no diff now expects
// `toBeVisible()` + `toBeDisabled()`; only the Review OFF transition itself
// still hides them.

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

/**
 * 0.6.12: click the ONE permanent toolbar button that gates the whole
 * review surface (badges/counts/chip, 「変更 N」/「✓ 確認」, highlights,
 * strikethrough deletions) on or off — see modules/reviewMode.js.
 */
async function toggleReviewMode(page) {
  await page.locator('#reviewModeToggle').click();
}

const FILE = 'review.md';

// A tight bullet list (no blank lines between items) keeps the Myers diff
// unambiguous — one changed bullet, one deleted bullet, one added bullet —
// which also happens to be exactly the shape the owner asked to see fixed
// (「削除行がwordみたいに横棒線がでるといいよね」, bullets being the
// day-to-day 議事録 review case; see CLAUDE.md's dogfood note). The changed
// bullet and the deleted bullet are kept NON-adjacent (an untouched bullet
// sits between them): a deletion immediately next to a change with no
// unchanged line between them gets folded into the SAME 'changed' hunk by
// src/utils/lineDiff.js's buildHunks() (both a delete and an insert inside
// one maximal non-equal run), which would produce no removedAt/removed
// entry at all for this fixture — an isolated deletion is what actually
// exercises the pure-deletion path this test is for.
const ORIGINAL = [
  '# Review Doc',
  '',
  '- Bullet one stays the same',
  '- Bullet two will change',
  '- Bullet three stays the same',
  '- Bullet four will be deleted',
  '- Bullet five stays too'
].join('\n') + '\n';

const EDITED = [
  '# Review Doc',
  '',
  '- Bullet one stays the same',
  '- Bullet two has changed now',
  '- Bullet three stays the same',
  '- Bullet five stays too',
  '- New bullet appended'
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

test('0.6.12 unified review mode (owner): default OFF shows zero review chrome even with a pending diff; one Review click reveals 「次の変更 N」/「✓ 確認」+ highlights + strikethrough deletion together; ⌥↑↓ AND clicking 「次の変更 N」 both jump; state survives reload; one Review click disables everything; ✓ 確認 disables the buttons (they stay mounted) and clears the baseline', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${FILE}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');

  // 0.6.12: the ONE permanent toolbar button that gates the whole review
  // surface — see modules/reviewMode.js. Defaults OFF.
  const reviewToggle = page.locator('#reviewModeToggle');
  await expect(reviewToggle).not.toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');

  // 0.6.8 Word-like declutter (owner): the old #diffReviewBar 3rd band is
  // gone — the toolbar's #diffToggleBtn/#diffConfirmBtn replace it. 0.6.12:
  // both are ALSO gated by Review mode now, on top of "is there a diff".
  const toggleBtn = page.locator('#diffToggleBtn');
  const confirmBtn = page.locator('#diffConfirmBtn');

  // First-ever open: no prior baseline -> silently recorded, no toolbar
  // controls (there is genuinely nothing to show yet, independent of
  // Review mode).
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await waitForBaseline(page, FILE);

  // Rewrite the file on disk while it's the active/watched tab. chokidar's
  // awaitWriteFinish adds latency before file_update arrives (see
  // 04-external-file-change.spec.js) — poll instead of asserting immediately.
  await writeFile(path.join(fixtureDir, FILE), EDITED, 'utf-8');
  await expect(page.locator('#content')).toContainText('Bullet two has changed now', { timeout: 3000 });

  // 0.6.12 (a): background tracking now HAS a real 3-change diff (proven
  // below, the instant Review turns ON) — but with Review still OFF,
  // NOTHING review-related shows: not the toolbar buttons, not highlights,
  // not the strikethrough deletion. Give the async file_update -> GET
  // /api/diff round trip time to settle before asserting an absence (a
  // slow round trip racing this check would give a false pass).
  await page.waitForTimeout(1000);
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(page.locator('#content .diff-removed-inline')).toHaveCount(0);

  const changedLi = page.locator('#content li.diff-changed', { hasText: 'Bullet two has changed now' });
  const addedLi = page.locator('#content li.diff-added', { hasText: 'New bullet appended' });
  const removedInline = page.locator('#content .diff-removed-inline');

  // 0.6.12 (b): ONE click on Review reveals 「次の変更 N」/「✓ 確認」 AND
  // highlights AND the strikethrough deletion, all together — proving the
  // diff was tracked accurately in the background the whole time Review
  // was OFF (no re-scan needed). 0.6.14: a real pending diff means both
  // buttons are enabled, not just visible.
  await toggleReviewMode(page);
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeEnabled();
  await expect(toggleBtn).toHaveText('次の変更 3');
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeEnabled();
  await expect(changedLi).toBeVisible();
  await expect(addedLi).toBeVisible();
  await expect(removedInline).toHaveCount(1);

  // Added AND changed both get the SAME yellow treatment (owner: 「追加も
  // 変更も黄色で良い気がする」) — assert the two classes compute to the
  // identical background, not just "both present".
  const [changedBg, addedBg] = await Promise.all([
    changedLi.evaluate((el) => getComputedStyle(el).backgroundColor),
    addedLi.evaluate((el) => getComputedStyle(el).backgroundColor)
  ]);
  expect(changedBg).toBe(addedBg);
  // Untouched bullets/heading must not be flagged.
  await expect(page.locator('#content li', { hasText: 'Bullet one stays the same' }))
    .not.toHaveClass(/diff-added|diff-changed/);
  await expect(page.locator('#content h1')).not.toHaveClass(/diff-added|diff-changed/);

  // The deleted bullet shows up inline, Word-style: the actual deleted
  // text, struck through — not just a marker (0.6.10 replaced the old
  // .diff-removed-after tick with this).
  await expect(removedInline).toContainText('Bullet four will be deleted');
  await expect(removedInline).toHaveCSS('text-decoration-line', 'line-through');

  // ...and the deleted text is genuinely gone from the file's raw content —
  // this is a presentational-only echo of history, not a data leak/undo.
  const raw = await page.evaluate(async (p) => {
    const res = await fetch('/api/file?path=' + encodeURIComponent(p));
    const data = await res.json();
    return data.raw;
  }, FILE);
  expect(raw).not.toContain('Bullet four will be deleted');

  // ⌥↑↓ still cycles through adds/changes/deletions (0.6.10: the injected
  // .diff-removed-inline block is now a jump target too). In document
  // order the changed bullet precedes the inline deletion block, which
  // precedes the added bullet — the first ⌥↓ from no selection lands on
  // the changed bullet.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(changedLi).toBeInViewport();
  await expect(changedLi).toHaveClass(/diff-jump-flash/);
  // The flash class is temporary (~DIFF_JUMP_FLASH_MS) — it must clear on
  // its own without disturbing the persistent diff-changed highlight.
  await expect(changedLi).not.toHaveClass(/diff-jump-flash/, { timeout: 3000 });
  await expect(changedLi).toHaveClass(/diff-changed/);

  // 0.6.12: clicking 「次の変更 N」 no longer toggles markup — Review mode
  // already implies markup shown, so there's nothing left for it to toggle.
  // It now jumps to the next change instead, same as ⌥↓: the previous ⌥↓
  // landed on the changed bullet (jump index 0), so one more jump lands on
  // the inline deletion block next (index 1, see the comment above on
  // document order).
  await toggleBtn.click();
  await expect(removedInline).toHaveClass(/diff-jump-flash/);
  await expect(removedInline).not.toHaveClass(/diff-jump-flash/, { timeout: 3000 });

  // Reload WITHOUT confirming: Review mode is a GLOBAL preference — it was
  // just turned ON above, so it must survive the reload and paint
  // everything immediately, with no re-click. The localStorage baseline
  // (recorded on first open, still older than the on-disk edit) survives
  // too, so the toolbar controls reappear.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggleBtn).toBeVisible({ timeout: 3000 });
  await expect(toggleBtn).toBeEnabled();
  await expect(toggleBtn).toHaveText('次の変更 3');
  await expect(changedLi).toBeVisible();
  await expect(removedInline).toHaveCount(1);

  // 0.6.12: disabling Review clears EVERYTHING in one click — toolbar
  // buttons, highlights, and the strikethrough deletion together (still the
  // same open diff underneath — background tracking never forgot it).
  // 0.6.14: OFF is the one transition that still hides the buttons outright.
  await toggleReviewMode(page);
  await expect(reviewToggle).not.toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(removedInline).toHaveCount(0);

  // Re-enable Review to exercise 「✓ 確認」 (only enabled while there is a
  // pending diff, same gate as 「次の変更 N」) — the diff was never
  // confirmed above, so it's still pending.
  await toggleReviewMode(page);
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeEnabled();
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeEnabled();

  // 「✓ 確認」 clears the highlights and updates the stored baseline hash to
  // the current content. 0.6.8 Word-like declutter (owner): same action as
  // the old in-bar 「最新を確認済みにする」, now a plain toolbar button.
  // 0.6.14: with nothing left to review, the buttons stay MOUNTED (Review
  // is still ON) but go `disabled` instead of hiding — no more toolbar
  // reflow on confirm.
  await confirmBtn.click();
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled();
  await expect(toggleBtn).toHaveText('次の変更 0');
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeDisabled();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(removedInline).toHaveCount(0);

  // Persists: reloading again now shows the buttons mounted-but-disabled,
  // since the stored baseline matches the current (still-EDITED) content —
  // Review mode itself is still ON.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled();
});

test('0.6.12: Review mode migrates the 0.6.10 REVIEW_MARKUP preference once, then removes the old key', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await expect(page.locator('#content .welcome')).toBeVisible();

  // Simulate a returning user who had left the old (0.6.10) global markup
  // toggle ON, and never touched the new key.
  await page.evaluate(() => {
    localStorage.removeItem('mdv-review-mode');
    localStorage.setItem('mdv-review-markup', 'true');
  });
  await page.reload();

  const reviewToggle = page.locator('#reviewModeToggle');
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');

  const keys = await page.evaluate(() => ({
    legacy: localStorage.getItem('mdv-review-markup'),
    current: localStorage.getItem('mdv-review-mode')
  }));
  expect(keys.legacy).toBeNull();
  expect(keys.current).toBe('true');

  // A SECOND reload must not re-migrate (the legacy key is already gone) —
  // toggling Review OFF here and reloading again must stick at OFF, not
  // snap back to the migrated ON value.
  await toggleReviewMode(page);
  await expect(reviewToggle).not.toHaveClass(/active/);
  await page.reload();
  await expect(reviewToggle).not.toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');
});

test('toolbar diff controls go disabled (not hidden) when the last tab is closed (welcome view)', async ({ page }) => {
  const p = 'closeme.md';
  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n');
  await page.goto(server.baseURL + '/');
  await expect(page.locator(`.tree-item[data-path="${p}"] .name`)).toBeVisible();
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Close Me');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# Close Me\n\n本文の段落。\n\n追記の段落。\n');
  // 0.6.12: #diffToggleBtn is gated by Review mode now too — enable it
  // before this visibility check (0.6.8 Word-like declutter, owner: the
  // toolbar's #diffToggleBtn replaces the old #diffReviewBar).
  await toggleReviewMode(page);
  const toggleBtn = page.locator('#diffToggleBtn');
  const confirmBtn = page.locator('#diffConfirmBtn');
  await expect(toggleBtn).toBeVisible({ timeout: 6000 });
  await expect(toggleBtn).toBeEnabled();

  // Close the last tab -> welcome view (no tab at all, `_current` goes
  // null). 0.6.14 (layout-stability fix, owner): with Review still ON the
  // buttons stay MOUNTED — they go `disabled` ("次の変更 0"), they don't
  // vanish (that used to shift the PDF/Style/Review/search controls to
  // their right every time this happened — codex).
  await page.locator('#tabBar .tab .tab-close').click();
  await expect(page.locator('#content .welcome')).toBeVisible();
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled();
  await expect(toggleBtn).toHaveText('次の変更 0');
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeDisabled();

  // Disabling Review itself still hides them outright — that's the one
  // remaining transition allowed to reflow the toolbar.
  await toggleReviewMode(page);
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
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

  // 0.6.12: enable Review mode before any toolbar/highlight assertion —
  // #diffToggleBtn is gated by it now, and Review ON already implies
  // highlights shown (no separate click needed, unlike the 0.6.10 markup
  // toggle this replaces). 0.6.8 Word-like declutter (owner): the toolbar
  // button replaces the old bar.
  await toggleReviewMode(page);
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
  // 0.6.12: enable Review mode first — #diffToggleBtn won't show at all
  // otherwise. 0.6.8 Word-like declutter (owner): the toolbar's 「次の変更
  // N」 button replaces the bar; the regression this guards against showed
  // the unknown-baseline label (「次の変更 ?」) here instead of a real count.
  await toggleReviewMode(page);
  const toggleBtn = page.locator('#diffToggleBtn');
  await expect(toggleBtn).toBeVisible({ timeout: 6000 });
  await expect(toggleBtn).toBeEnabled();
  await expect(toggleBtn).toHaveText(/^次の変更 \d+$/);
  await expect(toggleBtn).not.toHaveText('次の変更 ?');
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
  // 0.6.12: enable Review mode ONCE, here — it's a per-origin localStorage
  // preference (same `base` origin for both project A and B below), so it
  // survives the about:blank/serverA-stop/serverB-start dance and makes the
  // final hidden-check below meaningful (otherwise #diffToggleBtn would
  // stay hidden regardless of whether the cross-project-bleed bug exists).
  await toggleReviewMode(page);
  await page.locator('.tree-item[data-path="shared.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('Project A');
  await waitForBaseline(page, 'shared.md');
  await page.goto('about:blank');
  await serverA.stop();

  const rootB = await makeFixtureDir('mdv-e2e-rootB-');
  await seedFiles(rootB, { 'shared.md': '# Project B\n\nBの本文はまったく別物。\n' });
  const serverB = await startServer(rootB, { port: portToReuse });
  await page.goto(base + '/');
  await expect(page.locator('#reviewModeToggle')).toHaveClass(/active/);
  await page.locator('.tree-item[data-path="shared.md"] [data-action="open"]').click();
  await expect(page.locator('#content h1')).toHaveText('Project B');
  await page.waitForTimeout(700);
  // With the bug, A's hash mismatches B's content -> a spurious pending
  // diff, i.e. the button would be ENABLED with a nonzero count. Without
  // the bug, project B has no baseline of its own yet, so first-sight
  // silently records one and `_current` goes null — 0.6.14: that still
  // means the button stays MOUNTED (Review is ON) but DISABLED, not hidden.
  const toggleBtnB = page.locator('#diffToggleBtn');
  await expect(toggleBtnB).toBeVisible();
  await expect(toggleBtnB).toBeDisabled();
  await expect(toggleBtnB).toHaveText('次の変更 0');
  await page.goto('about:blank');
  await serverB.stop();
  await removeFixtureDir(rootA);
  await removeFixtureDir(rootB);
  // Restart the shared suite server so later tests and afterAll find a
  // live instance. NO port override: the helper's baseURL reflects its
  // own port pick, so forcing portToReuse here left server.baseURL
  // pointing at a dead port for every later test (latent until 0.6.10
  // added one).
  server = await startServer(fixtureDir);
});

test('0.6.10: a deleted FIRST line appears struck-through ABOVE the first block (codex)', async ({ page }) => {
  const p = 'topdel.md';
  await writeFile(path.join(fixtureDir, p), '一行目の見出し\n\n# 本文の見出し\n\n本文の段落。\n');
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content')).toContainText('本文の見出し');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# 本文の見出し\n\n本文の段落。\n');
  // 0.6.12: 既定OFFなのでまずReviewボタンでON（localStorage直書きは起動時
  // にしか読まれないため効かない）。ON にした時点でハイライト/取り消し線
  // は自動表示（0.6.10の別トグルは廃止）— #diffToggleBtn のクリックは不要。
  await toggleReviewMode(page);
  const inline = page.locator('.diff-removed-inline');
  await expect(inline).toBeVisible({ timeout: 6000 });
  await expect(inline).toContainText('一行目の見出し');
  // 取り消し線ブロックが最初のコンテンツブロックより上にあること
  const isAbove = await page.evaluate(() => {
    const del = document.querySelector('.diff-removed-inline');
    const first = document.querySelector('#content [data-source-line]');
    return !!(del && first) && !!(del.compareDocumentPosition(first) & 4); // 4 = DOCUMENT_POSITION_FOLLOWING
  });
  expect(isAbove).toBe(true);
});

test('0.6.10: deleting the ENTIRE document still shows the struck-through text (codex round-2)', async ({ page }) => {
  const p = 'wipeout.md';
  await writeFile(path.join(fixtureDir, p), '# 全部消える見出し\n\n消える本文。\n');
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content')).toContainText('全部消える見出し');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '');
  // 0.6.12: Review ON first — see the "topdel" test above for why no
  // separate #diffToggleBtn click is needed.
  await toggleReviewMode(page);
  const inline = page.locator('.diff-removed-inline');
  await expect(inline).toBeVisible({ timeout: 6000 });
  await expect(inline).toContainText('全部消える見出し');
});

test('0.6.10: a deletion next to a list lands BETWEEN blocks, not inside the list (codex round-4)', async ({ page }) => {
  const p = 'nested.md';
  await writeFile(path.join(fixtureDir, p), '# 見出し\n\n- 項目1\n- 項目2\n\n消える段落。\n');
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content')).toContainText('項目2');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# 見出し\n\n- 項目1\n- 項目2\n');
  // 0.6.12: Review ON first — see the "topdel" test above for why no
  // separate #diffToggleBtn click is needed.
  await toggleReviewMode(page);
  const inline = page.locator('.diff-removed-inline');
  await expect(inline).toBeVisible({ timeout: 6000 });
  await expect(inline).toContainText('消える段落');
  // 取り消し線ブロックが <ul> の中に入っていないこと
  const insideList = await page.evaluate(() => !!document.querySelector('ul .diff-removed-inline, ol .diff-removed-inline, pre .diff-removed-inline, table .diff-removed-inline'));
  expect(insideList).toBe(false);
});

test('0.6.10: a MID-LIST deletion renders between the surviving bullets (codex round-5)', async ({ page }) => {
  const p = 'midlist.md';
  await writeFile(path.join(fixtureDir, p), '# 見出し\n\n- 項目1\n- 消える項目\n- 項目3\n');
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content')).toContainText('項目3');
  await waitForBaseline(page, p);

  await writeFile(path.join(fixtureDir, p), '# 見出し\n\n- 項目1\n- 項目3\n');
  // 0.6.12: Review ON first — see the "topdel" test above for why no
  // separate #diffToggleBtn click is needed.
  await toggleReviewMode(page);
  const inline = page.locator('ul .diff-removed-inline');
  await expect(inline).toBeVisible({ timeout: 6000 });
  await expect(inline).toContainText('消える項目');
  // 項目1 と 項目3 の間にあること（liとして siblings 順を検証）
  const order = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#content ul > li')).map((li) => li.textContent.trim());
    return items.join('|');
  });
  expect(order).toMatch(/項目1\|.*消える項目.*\|項目3/);
});

test('0.6.14 (owner: layout jitter) — #diffToggleBtn/#diffConfirmBtn staying mounted while Review is ON means the toolbar controls to their right never shift when switching between a tab with a pending diff and a tab with none', async ({ page }) => {
  const withDiff = 'jitter-with-diff.md';
  const noDiff = 'jitter-no-diff.md';
  await writeFile(path.join(fixtureDir, withDiff), '# Jitter A\n\n本文。\n');
  await writeFile(path.join(fixtureDir, noDiff), '# Jitter B\n\n変更なし。\n');
  await page.goto(server.baseURL + '/');

  // Tab 1: give it a genuine pending diff (external edit while open).
  await page.locator(`.tree-item[data-path="${withDiff}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Jitter A');
  await waitForBaseline(page, withDiff);
  await writeFile(path.join(fixtureDir, withDiff), '# Jitter A\n\n本文を更新した。\n');
  await expect(page.locator('#content')).toContainText('本文を更新した。', { timeout: 3000 });

  // Tab 2: opened fresh, no external edit since — first-sight records its
  // own baseline immediately, so it never has a pending diff to show.
  await page.locator(`.tree-item[data-path="${noDiff}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Jitter B');
  await waitForBaseline(page, noDiff);

  await toggleReviewMode(page);

  const searchTrigger = page.locator('#searchBoxToggle');
  const toggleBtn = page.locator('#diffToggleBtn');
  const tabWithDiff = page.locator('#tabBar .tab', { hasText: withDiff });
  const tabNoDiff = page.locator('#tabBar .tab', { hasText: noDiff });

  // Currently on the no-diff tab: button mounted+disabled, not hidden.
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled();
  const xNoDiff = (await searchTrigger.boundingBox()).x;

  // Switch to the pending-diff tab: button mounted+enabled with a real
  // count — the search box must not have moved even though the button's
  // enabled state (and label) just changed.
  await tabWithDiff.click();
  await expect(toggleBtn).toBeEnabled();
  await expect(toggleBtn).toHaveText('次の変更 1');
  const xWithDiff = (await searchTrigger.boundingBox()).x;
  expect(xWithDiff).toBe(xNoDiff);

  // ...and back again — still no movement.
  await tabNoDiff.click();
  await expect(toggleBtn).toBeDisabled();
  const xBack = (await searchTrigger.boundingBox()).x;
  expect(xBack).toBe(xNoDiff);
});

test('regression (実装計画_2026-07-13_reviewベースライン消失.md): Review turned ON BEFORE any edit, then the file is churned by external writes MANY more times than the version cap — the highlight must keep showing every time, not just for the first few edits', async ({ page }) => {
  // Every OTHER test in this file enables Review mode AFTER the edit(s)
  // that create the pending diff. That ordering never exercised the
  // reported bug: with Review already ON while a file keeps getting
  // rewritten (mdv's own autosave, or any external tool saving repeatedly),
  // the journal's per-file version cap used to evict the client's pinned
  // baseline (H0) once enough versions piled up (old cap: 4 — a single
  // ~6s autosave burst). This test is the ordering that shipped the bug:
  // Review ON FIRST, edits AFTER, well past JOURNAL_MAX_VERSIONS_PER_FILE.
  const p = 'churn.md';
  const original = ['# Churn Doc', '', 'Line stays the same.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), original);
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Churn Doc');
  await waitForBaseline(page, p);

  await toggleReviewMode(page);
  const toggleBtn = page.locator('#diffToggleBtn');
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled(); // no pending diff yet — baseline == current content

  const changedLine = page.locator('#content .diff-changed, #content .diff-added');

  for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 3; i++) {
    const edited = ['# Churn Doc', '', `Line changed ${i} times.`].join('\n') + '\n';
    await writeFile(path.join(fixtureDir, p), edited, 'utf-8');
    await expect(page.locator('#content')).toContainText(`Line changed ${i} times.`, { timeout: 3000 });

    // The toolbar must report a real, resolvable diff against the
    // ORIGINAL baseline (H0) on EVERY single edit — "次の変更 ?" is what
    // unknown-baseline renders as (diffReview.js), the exact symptom the
    // owner reported ("ボタンが「次の変更 ?」になるだけで、本文には一切
    // ハイライトが出ない"). No 確認/confirm click happens anywhere in this
    // loop, so the baseline never advances — H0 must keep resolving.
    await expect(toggleBtn).toBeEnabled();
    await expect(toggleBtn).toHaveText(/^次の変更 \d+$/);
    await expect(toggleBtn).not.toHaveText('次の変更 ?');
    await expect(toggleBtn).not.toHaveText('次の変更 0');

    // And the actual body highlight — not just the toolbar count — is
    // present. This is the part that silently disappeared in the bug: the
    // toolbar could still say "?" while the body showed nothing at all.
    await expect(changedLine).not.toHaveCount(0);
  }
});

test('regression Fix 5 (実装計画_2026-07-13_reviewベースライン消失.md §3, 2026-07-13): opening a file with Review ON while NOTHING has changed yet (the fast path) still pins the baseline, so edit-mode autosave churn past the version cap does not lose it', async ({ page }) => {
  // The test above ("Review turned ON BEFORE any edit...") already covers
  // Fix 1-4's scope, but it never exercises this gap: EVERY edit in that
  // loop goes through diffReview.js's REAL diff branch (content always
  // differs from the baseline), which already called journal.get() (and
  // so already pinned) before Fix 5 existed. The bug this test guards
  // against needs the OPPOSITE precondition: a refresh() call where
  // nothing has changed yet (tab.etag === lastSeen.hash) — diffReview.js's
  // "fast path" — followed by edit mode, where refresh() early-returns
  // and NO /api/diff call of any kind happens until edit mode ends.
  const p = 'fastpath-editmode.md';
  const original = ['# Fastpath Edit Doc', '', 'Base line stays for now.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), original);
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Fastpath Edit Doc');
  await waitForBaseline(page, p);
  await toggleReviewMode(page);

  // Step 1: get a REAL, non-null tab.etag onto the open tab (a freshly-
  // opened non-Marp tab's etag stays null until a live file_update WS
  // message sets it — see this module's docstring's "0.6.14"/etag-table
  // section referenced in diffReview.js) and confirm it, so lastSeen.hash
  // matches tab.etag exactly — the fast path's precondition.
  const confirmed = ['# Fastpath Edit Doc', '', 'Base line confirmed once.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), confirmed, 'utf-8');
  await expect(page.locator('#content')).toContainText('Base line confirmed once.', { timeout: 3000 });
  const toggleBtn = page.locator('#diffToggleBtn');
  const confirmBtn = page.locator('#diffConfirmBtn');
  await expect(toggleBtn).toHaveText('次の変更 1');
  await confirmBtn.click();
  await expect(toggleBtn).toBeDisabled();
  await expect(toggleBtn).toHaveText('次の変更 0');

  // Step 2: trigger ANOTHER refresh() for the SAME still-active tab with
  // NOTHING changed since the confirm above (tab.etag === lastSeen.hash)
  // -- this is what actually takes diffReview.js's fast path (a tab
  // switch or first-ever open both count as a "path change", which the
  // fast path explicitly excludes -- codex round-11). A theme toggle is a
  // convenient, content-independent way to force a second renderActive()
  // -> refresh() on the same tab (modules/theme.js's ThemeManager.toggle()
  // calls the same renderActive() TabManager wraps everywhere else).
  await page.locator('#themeToggle').click();
  // The fast-path seed request is fire-and-forget (diffReview.js) -- give
  // the one local round trip time to land (pins the baseline server-side,
  // Fix 5) before the edit-mode churn below starts.
  await page.waitForTimeout(800);

  // Step 3: enter edit mode. diffReview.js's refresh() early-returns
  // while state.isEditMode is true, so NOTHING calls /api/diff again
  // until we leave.
  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).toHaveClass(/active/);
  const textarea = page.locator('#editorTextarea');
  await expect(textarea).toBeVisible();

  // Step 4: autosave-during-edit-mode simulation, WITHOUT waiting on real
  // fs-write/chokidar timing for every single version (the plan's
  // instruction to keep this test fast): record synthetic versions
  // directly into the SAME journal instance the running server uses,
  // strictly MORE times than JOURNAL_MAX_VERSIONS_PER_FILE so the version
  // cap is actually exercised (a smaller loop would pass without touching
  // the fix at all -- same space-out warning as the plan's §4 / the
  // sibling test above).
  const journal = server.mdv.app.locals.changeJournal;
  for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
    journal.record(p, `synthetic churn v${i}\n`);
  }

  // One REAL write so the file on disk (and the live tab -- the
  // watcher's file_update broadcast keeps flowing even in edit mode, see
  // websocket.js's handleFileUpdate(), which updates tab.etag AND the
  // visible textarea since nothing was typed) actually differs from the
  // pinned baseline by the time we leave edit mode.
  const edited = ['# Fastpath Edit Doc', '', 'Base line was actually edited after the churn.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), edited, 'utf-8');
  await expect(textarea).toHaveValue(edited, { timeout: 6000 });

  // Step 5: leave edit mode -- hide() re-renders, which resumes
  // refresh(). The pinned baseline is now far behind current content, so
  // this is a REAL diff request, not the fast path -- and it must
  // resolve, not unknown-baseline (the bug: the baseline would already be
  // evicted here without Fix 5, since it was never pinned in step 2).
  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).not.toHaveClass(/active/);

  await expect(toggleBtn).toBeEnabled({ timeout: 6000 });
  await expect(toggleBtn).toHaveText(/^次の変更 \d+$/);
  await expect(toggleBtn).not.toHaveText('次の変更 ?');
  await expect(toggleBtn).not.toHaveText('次の変更 0');
  await expect(page.locator('#content .diff-added, #content .diff-changed')).not.toHaveCount(0);
});

test('regression P1 (codex, 2026-07-14 review round): review -> external edit -> ✓ 確認 -> edit mode DIRECTLY (no other action in between) still survives autosave churn past the version cap, even though an EARLIER hash for this SAME path was already fast-path-seeded once this page load', async ({ page }) => {
  // The sibling Fix 5 test above proves the ORIGINAL pin (the very FIRST
  // fast-path seed for a path) survives edit-mode churn. It does NOT
  // exercise this bug: modules/diffReview.js's `_seededPaths` Set used to
  // be keyed by PATH ALONE ("seed at most once per path per page load"),
  // so once ANY hash for a path had been seeded once, `_confirmLatest()`
  // (the ✓ 確認 button) advancing that SAME path's baseline to a LATER
  // hash could never seed/pin it again — every future fast-path refresh()
  // silently no-opped. `_confirmLatest()` itself also never sent a seed/
  // pin request of its own pre-fix, relying entirely on some LATER
  // fast-path refresh to do it — but entering edit mode right after
  // confirming does NOT reliably trigger one: app.js's init() wraps
  // EditorManager.show() to call refresh() afterward, but
  // EditorManager.toggle() already sets state.isEditMode = true BEFORE
  // calling show(), so that refresh() hits the state.isEditMode guard and
  // returns before ever reaching the fast path. Both gaps compound in the
  // most natural flow of all: review a change, confirm it, start editing.
  //
  // This test reproduces BOTH preconditions: an EARLIER hash for this path
  // is fast-path-seeded first (cycle 0, populating the pre-fix `_seededPaths`
  // Set for this path), THEN a SECOND external edit is reviewed, confirmed,
  // and followed DIRECTLY by edit mode with no theme-toggle/tab-switch/etc.
  // in between (cycle 1 — the exact "review -> 確認 -> 編集" sequence codex
  // reported). Without BOTH fixes (seed key = path+hash, not just path;
  // _confirmLatest() seeds explicitly instead of waiting for a later
  // trigger), the confirmed baseline from cycle 1 is never pinned and gets
  // evicted by the churn below, reintroducing unknown-baseline right after
  // the most natural review workflow there is.
  const p = 'repin-editmode.md';
  const original = ['# Repin Doc', '', 'Base line stays for now.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), original);
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('Repin Doc');
  await waitForBaseline(page, p);
  await toggleReviewMode(page);
  const toggleBtn = page.locator('#diffToggleBtn');
  const confirmBtn = page.locator('#diffConfirmBtn');

  // --- Cycle 0: pre-seed `_seededPaths` for this path with an EARLIER
  // hash, exactly like the sibling Fix 5 test's technique (confirm first
  // so tab.etag === lastSeen.hash, then force a second refresh() with a
  // theme toggle to actually take the fast path).
  const edit0 = ['# Repin Doc', '', 'Base line confirmed once.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), edit0, 'utf-8');
  await expect(toggleBtn).toHaveText('次の変更 1');
  await confirmBtn.click();
  await expect(toggleBtn).toBeDisabled();
  await expect(toggleBtn).toHaveText('次の変更 0');
  await page.locator('#themeToggle').click();
  // Fire-and-forget seed request — give it time to land server-side
  // before cycle 1 starts (matches the sibling Fix 5 test's own margin).
  await page.waitForTimeout(800);

  // --- Cycle 1 (the one under test): a SECOND external edit, reviewed and
  // confirmed, with edit mode entered IMMEDIATELY after — no theme toggle,
  // no tab switch, nothing else that could incidentally re-seed the
  // baseline first.
  const edit1 = ['# Repin Doc', '', 'Base line changed a second time.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), edit1, 'utf-8');
  await expect(toggleBtn).toHaveText('次の変更 1');
  await confirmBtn.click();
  await expect(toggleBtn).toBeDisabled();
  await expect(toggleBtn).toHaveText('次の変更 0');

  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).toHaveClass(/active/);
  const textarea = page.locator('#editorTextarea');
  await expect(textarea).toBeVisible();

  // Autosave-during-edit-mode churn past the version cap, strictly MORE
  // times than JOURNAL_MAX_VERSIONS_PER_FILE (same space-out rule as every
  // other churn test in this file) — synthetic journal.record() calls
  // directly against the running server's journal instance, no real
  // fs-write/chokidar timing needed per version.
  const journal = server.mdv.app.locals.changeJournal;
  for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
    journal.record(p, `synthetic churn v${i}\n`);
  }

  // One REAL write so disk content genuinely differs from cycle 1's
  // confirmed baseline by the time edit mode ends.
  const final = ['# Repin Doc', '', 'Base line was actually edited after the churn.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), final, 'utf-8');
  await expect(textarea).toHaveValue(final, { timeout: 6000 });

  // Leave edit mode -- this is a REAL diff request against cycle 1's
  // confirmed baseline (content genuinely changed, not the fast path). It
  // must resolve, not unknown-baseline — the bug this test guards is that
  // baseline never having been (re-)pinned back in cycle 1's confirm step.
  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).not.toHaveClass(/active/);

  await expect(toggleBtn).toBeEnabled({ timeout: 6000 });
  await expect(toggleBtn).toHaveText(/^次の変更 \d+$/);
  await expect(toggleBtn).not.toHaveText('次の変更 ?');
  await expect(toggleBtn).not.toHaveText('次の変更 0');
  await expect(page.locator('#content .diff-added, #content .diff-changed')).not.toHaveCount(0);
});

test('regression P1 (codex 3rd-round review, 2026-07-14): FIRST-SIGHT baseline — a file opened, reviewed, and put into edit mode WITHOUT ever clicking ✓ 確認 (or triggering any other refresh() first) — survives autosave churn past the version cap', async ({ page }) => {
  // The two sibling regression tests above ("Fix 5" and the first "P1" test)
  // both pre-seed the pin via an explicit ✓ 確認 click (or the fast path's
  // own "nothing changed" re-seed) before entering edit mode. Neither one
  // exercises the FIRST-SIGHT branch of refresh() (`!lastSeen`): before this
  // fix, `_seedBaseline()` was called from exactly two places
  // (refresh()'s fast path and `_confirmLatest()`) — first sight's
  // `markSeen(tab.path, currentHash)` call was NOT one of them, so a file
  // that is opened, reviewed, and edited WITHOUT ever confirming (or
  // otherwise triggering a second refresh() first) had its baseline
  // recorded in localStorage but never pinned server-side. The very next
  // edit-mode autosave churn past the version cap evicted it, reproducing
  // unknown-baseline ("次の変更 ?", no highlight) right after the simplest
  // possible flow: open a file, turn Review on, start typing.
  const p = 'firstsight-editmode.md';
  const original = ['# First Sight Doc', '', 'Base line stays for now.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), original);
  await page.goto(server.baseURL + '/');
  await page.locator(`.tree-item[data-path="${p}"] [data-action="open"]`).click();
  await expect(page.locator('#content h1')).toHaveText('First Sight Doc');

  // First sight: refresh()'s `!lastSeen` branch records the baseline via
  // markSeen() the instant the tab opens — no edit, no confirm click, no
  // tab switch/theme toggle to trigger any OTHER refresh() first.
  await waitForBaseline(page, p);
  // The first-sight seed request markSeen() now fires (this fix) is
  // fire-and-forget — give the one local round trip time to land
  // server-side before the churn below starts (same margin the sibling
  // Fix 5/P1 tests give their own seed requests).
  await page.waitForTimeout(800);

  await toggleReviewMode(page);
  const toggleBtn = page.locator('#diffToggleBtn');
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toBeDisabled(); // no pending diff yet — baseline == current content

  // Enter edit mode DIRECTLY — no confirm click, no tab switch, no theme
  // toggle: nothing that could incidentally re-seed the baseline via some
  // OTHER code path before the churn below runs.
  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).toHaveClass(/active/);
  const textarea = page.locator('#editorTextarea');
  await expect(textarea).toBeVisible();

  // Autosave-during-edit-mode churn past the version cap, strictly MORE
  // times than JOURNAL_MAX_VERSIONS_PER_FILE (same technique as the sibling
  // churn tests above): synthetic journal.record() calls directly against
  // the running server's journal instance, no real fs-write/chokidar timing
  // needed per version.
  const journal = server.mdv.app.locals.changeJournal;
  for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
    journal.record(p, `synthetic churn v${i}\n`);
  }

  // One REAL write so disk content genuinely differs from the first-sight
  // baseline by the time edit mode ends.
  const edited = ['# First Sight Doc', '', 'Base line was actually edited after the churn.'].join('\n') + '\n';
  await writeFile(path.join(fixtureDir, p), edited, 'utf-8');
  await expect(textarea).toHaveValue(edited, { timeout: 6000 });

  // Leave edit mode -- this is a REAL diff request against the FIRST-SIGHT
  // baseline (content genuinely changed, not the fast path). It must
  // resolve, not unknown-baseline — the bug this test guards is that
  // baseline never having been pinned in the first place.
  await page.locator('#editToggle').click();
  await expect(page.locator('#editToggle')).not.toHaveClass(/active/);

  await expect(toggleBtn).toBeEnabled({ timeout: 6000 });
  await expect(toggleBtn).toHaveText(/^次の変更 \d+$/);
  await expect(toggleBtn).not.toHaveText('次の変更 ?');
  await expect(toggleBtn).not.toHaveText('次の変更 0');
  await expect(page.locator('#content .diff-added, #content .diff-changed')).not.toHaveCount(0);
});

test('integration P1 (codex 3rd-round review, 2026-07-14): markSeen() itself pins the baseline server-side — independent of WHICH caller invoked it', async ({ page }) => {
  // Exercises markSeen() directly (dynamic import of the same module
  // instance the running app already loaded — ES modules are cached by
  // resolved URL, so this is not a second copy), bypassing tab-open/
  // edit-mode choreography entirely. This isolates the ONE thing under
  // test: does markSeen(path, hash) — no matter who calls it — protect
  // `hash` from the journal's version-cap eviction? (Every real caller —
  // first sight, ✓ 確認, the zero-hunk auto-adopt, フォルダ内を確認済みにする
  // — funnels through markSeen(), so this single test stands in for all of
  // them; see diffReview.js's docstring's "markSeen() is also the ONE
  // place that pins..." section.)
  const p = 'seed-via-marksseen.md';
  await writeFile(path.join(fixtureDir, p), '# Seed Via markSeen\n\nBody.\n');
  await page.goto(server.baseURL + '/');
  // Wait for app bootstrap (state.rootPath comes from /api/info, fetched
  // before the tree renders — see app.js's init()) so markSeen()'s
  // storeKey() doesn't bail out for lack of a known root.
  await expect(page.locator('.tree-item').first()).toBeVisible();

  const hash = await page.evaluate(async (rel) => {
    const res = await fetch('/api/diff?path=' + encodeURIComponent(rel) + '&from=');
    const data = await res.json();
    return data.currentHash;
  }, p);
  expect(hash).toMatch(/^sha256:/);

  // Call markSeen() DIRECTLY — no tab was ever opened for this path, no
  // first-sight refresh(), no confirm click. If markSeen() itself pins,
  // this alone must be enough to protect the hash below.
  await page.evaluate(async ({ rel, h }) => {
    const mod = await import('/static/modules/diffReview.js');
    mod.markSeen(rel, h);
  }, { rel: p, h: hash });

  // Fire-and-forget seed request — give it time to land server-side.
  await page.waitForTimeout(500);

  // Churn this path's journal past the per-file version cap, entirely
  // server-side (no browser/tab involvement at all) — an unpinned baseline
  // is fair game for eviction here; a pinned one must survive.
  const journal = server.mdv.app.locals.changeJournal;
  for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
    journal.record(p, `synthetic churn v${i}\n`);
  }

  // A REAL content change on disk is required here: src/api/diff.js's
  // `from === currentHash` branch short-circuits straight to `identical`
  // WITHOUT ever consulting the journal at all, so leaving the file
  // untouched would make this assertion pass trivially regardless of
  // whether `hash` survived the churn above — it would never actually
  // exercise journal.get(path, hash).
  await writeFile(path.join(fixtureDir, p), '# Seed Via markSeen\n\nBody, changed after the churn.\n', 'utf-8');

  // Ask the server directly: is `hash` still diffable as a baseline against
  // the NOW-DIFFERENT current content? Unpinned + evicted ->
  // { available: false, reason: 'unknown-baseline' }.
  const result = await page.evaluate(async ({ rel, h }) => {
    const res = await fetch('/api/diff?path=' + encodeURIComponent(rel) + '&from=' + encodeURIComponent(h));
    return res.json();
  }, { rel: p, h: hash });

  expect(result.reason).not.toBe('unknown-baseline');
  expect(result.available).toBe(true);
  expect(result.identical).toBe(false);
});
