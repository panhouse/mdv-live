import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// modules/diffReview.js — 0.6.4 ハイライト + ジャンプ. Covers the full
// baseline lifecycle: first open silently records a baseline (no toolbar
// controls), a later external edit is detected via the live file_update ->
// GET /api/diff round trip and rendered as the toolbar's 「変更 N」/「✓ 確認」
// buttons + block highlights (0.6.8: the old standalone #diffReviewBar band
// is gone, see toggleBtn/confirmBtn below), ⌥↑↓ jump works, and the
// localStorage baseline (STORAGE_KEYS.LAST_SEEN, 'mdv-last-seen') survives
// reload whether or not the user confirmed it.
//
// 0.6.12 unified review mode (owner): Word's 校閲/Review tab mental model —
// ONE permanent toolbar button (`#reviewModeToggle`, label "Review") now
// gates the ENTIRE review surface, superseding 0.6.10's independent
// highlight sub-toggle. Every test below that used to click `#diffToggleBtn`
// to turn markup ON now clicks `#reviewModeToggle` instead — `#diffToggleBtn`
// itself no longer toggles anything; clicking it JUMPS to the next change
// (same as ⌥↓), and it (plus `#diffConfirmBtn`) is only ever visible while
// Review mode is ON. Every Playwright test gets a fresh browser context (no
// localStorage carried over), so "fresh profile, Review defaults OFF" needs
// no special setup — it's just the ambient state.

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

test('0.6.12 unified review mode (owner): default OFF shows zero review chrome even with a pending diff; one Review click reveals 「変更 N」/「✓ 確認」+ highlights + strikethrough deletion together; ⌥↑↓ AND clicking 「変更 N」 both jump; state survives reload; one Review click disables everything; ✓ 確認 clears the baseline', async ({ page }) => {
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

  // 0.6.12 (b): ONE click on Review reveals 「変更 N」/「✓ 確認」 AND
  // highlights AND the strikethrough deletion, all together — proving the
  // diff was tracked accurately in the background the whole time Review
  // was OFF (no re-scan needed).
  await toggleReviewMode(page);
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggleBtn).toBeVisible();
  await expect(toggleBtn).toHaveText('変更 3');
  await expect(confirmBtn).toBeVisible();
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

  // 0.6.12: clicking 「変更 N」 no longer toggles markup — Review mode
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
  await expect(toggleBtn).toHaveText('変更 3');
  await expect(changedLi).toBeVisible();
  await expect(removedInline).toHaveCount(1);

  // 0.6.12: disabling Review clears EVERYTHING in one click — toolbar
  // buttons, highlights, and the strikethrough deletion together (still the
  // same open diff underneath — background tracking never forgot it).
  await toggleReviewMode(page);
  await expect(reviewToggle).not.toHaveClass(/active/);
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(removedInline).toHaveCount(0);

  // Re-enable Review to exercise 「✓ 確認」 (only visible/clickable while
  // Review is ON, same as 「変更 N」).
  await toggleReviewMode(page);
  await expect(toggleBtn).toBeVisible();
  await expect(confirmBtn).toBeVisible();

  // 「✓ 確認」 clears the toolbar controls/highlights and updates the
  // stored baseline hash to the current content. 0.6.8 Word-like declutter
  // (owner): same action as the old in-bar 「最新を確認済みにする」, now a
  // plain toolbar button.
  await confirmBtn.click();
  await expect(toggleBtn).toBeHidden();
  await expect(confirmBtn).toBeHidden();
  await expect(page.locator('#content .diff-added, #content .diff-changed')).toHaveCount(0);
  await expect(removedInline).toHaveCount(0);

  // Persists: reloading again now shows no toolbar controls, since the
  // stored baseline matches the current (still-EDITED) content — even with
  // Review mode still ON.
  await page.reload();
  await expect(page.locator('#content h1')).toHaveText('Review Doc');
  await expect(reviewToggle).toHaveClass(/active/);
  await expect(toggleBtn).toBeHidden();
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

test('toolbar diff controls disappear when the last tab is closed (welcome view)', async ({ page }) => {
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
  // otherwise. 0.6.8 Word-like declutter (owner): the toolbar's 「変更 N」
  // button replaces the bar; the regression this guards against showed the
  // unknown-baseline label (「変更 ?」) here instead of a real count.
  await toggleReviewMode(page);
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
  // With the bug, A's hash mismatches B's content -> spurious toolbar
  // controls. 0.6.8 Word-like declutter (owner): toolbar button replaces
  // the bar for this assertion.
  await expect(page.locator('#diffToggleBtn')).toBeHidden();
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
