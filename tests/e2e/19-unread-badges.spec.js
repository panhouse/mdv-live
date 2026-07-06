import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// modules/unreadBadges.js — 0.6.5 未読●/フォルダバッジ + 次の未読へ
// (0.6.8: the green ✓ "seen" badge is REMOVED — owner: 「既読マーク(緑✓)
// いらない」; a read file now simply has no tree badge at all). Covers the
// full event-driven lifecycle: an external edit to a file that is NOT the
// active tab lights up its row + parent directory count, opening it clears
// the ● (no ✓ replaces it) and decrements the count, a brand-new file
// arrives unread, the sidebar header chip reflects the total and cycles to
// the next unread on click, and the directory context-menu bulk-confirm
// clears everything under it.
//
// 0.6.12 unified review mode (owner): Word's 校閲/Review tab mental model —
// every badge/count/chip this file asserts on is now ALSO gated by the ONE
// permanent `#reviewModeToggle` toolbar button (modules/reviewMode.js),
// default OFF. This suite enables Review mode first (see `toggleReviewMode`
// below) before any of the pre-existing badge assertions, and adds explicit
// coverage for the OFF state (zero chrome despite genuinely-unread files)
// and the ON/OFF transition itself (everything appears/disappears together
// in one click).
//
// 0.6.14 (owner: labels/placement/layout jitter, see modules/diffReview.js's
// docstring's "0.6.14" section): `#diffToggleBtn`'s label is now 「次の変更
// N」, and while Review mode is ON both toolbar buttons stay permanently
// MOUNTED (never `.hidden`) — "nothing to review right now" is expressed
// via `disabled`, not by hiding them. Every assertion below that used to
// expect `toBeHidden()` for these two buttons while Review is ON with no
// pending diff now expects `toBeVisible()` + `toBeDisabled()` instead; only
// the Review OFF transition itself still hides them.

let fixtureDir;
let server;

const DIR = 'docs';
const NOTE1 = `${DIR}/note1.md`;
const NOTE2 = `${DIR}/note2.md`;
const NOTE3 = `${DIR}/note3.md`;
const README = 'readme.md';

/**
 * Baseline capture (diffReview.js's first-sight /api/diff round trip) is
 * async — poll the namespaced localStorage entry instead of a fixed sleep
 * (same convention as 18-diff-highlight.spec.js's waitForBaseline).
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
 * review surface (badges/counts/chip, 「次の変更 N」/「✓ 確認」, highlights,
 * strikethrough deletions) on or off — see modules/reviewMode.js.
 */
async function toggleReviewMode(page) {
    await page.locator('#reviewModeToggle').click();
}

test.beforeAll(async () => {
    fixtureDir = await makeFixtureDir('mdv-e2e-unread-');
    await seedFiles(fixtureDir, {
        // Three paragraphs (0.6.12): lets the main test's opening sequence
        // produce BOTH a changed-paragraph highlight AND a deleted-paragraph
        // strikethrough from ONE external edit to the active tab, alongside
        // note1.md's unread badge — see that test's "0.6.12 (a)"/"(b)" steps.
        // The middle paragraph is kept UNCHANGED between the edited first
        // paragraph and the deleted last one so they land in separate hunks
        // (changed + removed) instead of being folded into one 'changed'
        // hunk — same non-adjacency trick 18-diff-highlight.spec.js's
        // fixture comment explains (src/utils/lineDiff.js's buildHunks()).
        [README]: '# Readme\n\nTop-level file.\n\nMiddle paragraph stays the same.\n\nSecond paragraph.\n',
        [NOTE1]: '# Note 1\n\nOriginal paragraph.\n',
    });
    server = await startServer(fixtureDir);
    // Let chokidar's initial scan fully settle before any page/WS client
    // connects (same "let watcher + debounce settle" idiom as
    // tests/test-tree-refresh-storm.js). Without this, a startup-adjacent
    // FS event for one of the just-seeded fixture files can occasionally
    // race a client's very first `watch`/render — broadcasting the
    // unread-badges feed to zero clients (nobody connected yet) rather
    // than risk the test's own page picking up spurious "unread" noise.
    await new Promise((r) => setTimeout(r, 500));
});

test.afterAll(async () => {
    await server.stop();
    await removeFixtureDir(fixtureDir);
});

test('0.6.12 unified review mode (owner): default OFF hides unread badges/chip/diff chrome even with a genuinely unread file + a pending diff; enabling Review reveals badges AND highlights AND strikethrough together in one click; ⌥⇧↓ is inert while OFF; disabling Review clears everything in one click; (Review then left ON) external edit lights up a non-open file + its folder, opening it clears both, a new file arrives unread, the header chip cycles, and folder mark-all clears everything', async ({ page }) => {
    await page.goto(server.baseURL + '/');

    // 0.6.12: the ONE permanent toolbar button that gates the whole review
    // surface — see modules/reviewMode.js. Defaults OFF.
    const reviewToggle = page.locator('#reviewModeToggle');
    await expect(reviewToggle).not.toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');

    // Open readme.md — a first-ever open (no prior baseline) auto-confirms
    // via diffReview.js's first-sight markSeen(), which fires the onSeen
    // seam this module subscribes to: OPENING a file clears any unread ●
    // immediately (0.6.8: there's no ✓ to show instead — see this file's
    // header comment) — it also establishes an "active tab" so later "next
    // unread" cycling has somewhere to cycle FROM.
    await page.locator(`.tree-item[data-path="${README}"] [data-action="open"]`).click();
    await expect(page.locator('#content h1')).toHaveText('Readme');
    await waitForBaseline(page, README);

    // 0.6.8 Word-like declutter (owner): no ✓ badge — a freshly-opened,
    // unread-free file simply carries no tree badge at all.
    const readmeBadge = page.locator(`.tree-item[data-path="${README}"] > .tree-item-content > .tree-badge-status`);
    await expect(readmeBadge).toHaveCount(0);

    const chip = page.locator('#unreadCountChip');
    await expect(chip).toBeHidden();

    // Expand the docs/ directory (root-level dirs are already loaded — see
    // 06-pagination.spec.js — so this only toggles the collapsed class).
    const dirRow = page.locator(`.tree-item[data-path="${DIR}"]`);
    await dirRow.locator(':scope > .tree-item-content').click();

    const note1Row = page.locator(`.tree-item[data-path="${NOTE1}"]`);
    await expect(note1Row).toBeVisible();

    const note1Badge = note1Row.locator(':scope > .tree-item-content > .tree-badge-status');
    const dirBadge = dirRow.locator(':scope > .tree-item-content > .tree-badge-count');
    const toggleBtn = page.locator('#diffToggleBtn');
    const confirmBtn = page.locator('#diffConfirmBtn');

    // 0.6.12 (a): create BOTH a genuinely unread file (note1.md, NOT the
    // active tab) AND a genuine 2-hunk pending diff with a real deletion
    // (readme.md, the ACTIVE tab itself — one paragraph changed, one
    // deleted) at once, while Review mode is still OFF.
    await writeFile(path.join(fixtureDir, NOTE1), '# Note 1\n\nExternally changed paragraph.\n', 'utf-8');
    await writeFile(
        path.join(fixtureDir, README),
        '# Readme\n\nTop-level file, updated.\n\nMiddle paragraph stays the same.\n',
        'utf-8'
    );
    await expect(page.locator('#content')).toContainText('Top-level file, updated.', { timeout: 3000 });

    // Give both the files_changed broadcast and the file_update -> /api/diff
    // round trip time to settle before asserting an ABSENCE of chrome (a
    // slow round trip racing this check would give a false pass).
    await page.waitForTimeout(1000);

    // Review OFF: ZERO review chrome anywhere — not the unread ●, not the
    // folder count, not the header chip, not the toolbar diff controls, not
    // a single highlight/strikethrough — even though BOTH a genuinely
    // unread file AND a genuine diff exist right now (proven below, the
    // instant Review turns ON).
    await expect(note1Badge).toHaveCount(0);
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();
    await expect(toggleBtn).toBeHidden(); // Review OFF: still hidden outright
    await expect(confirmBtn).toBeHidden();
    await expect(page.locator('#content .diff-added, #content .diff-changed, #content .diff-removed-inline'))
        .toHaveCount(0);

    // ⌥⇧↓ (next-unread) is inert while OFF — pressing it must not navigate
    // away from readme.md even though note1.md is genuinely unread right now.
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(page.locator('#content h1')).toHaveText('Readme');

    // 0.6.12 (b): ONE click on Review reveals the unread ●/folder count/
    // header chip AND the toolbar diff controls AND highlights/strikethrough,
    // all together — proving everything was tracked accurately in the
    // background the whole time Review was OFF (no re-scan needed).
    await toggleReviewMode(page);
    await expect(reviewToggle).toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(note1Badge).toHaveClass(/is-unread/);
    await expect(note1Badge).toHaveText('●');
    await expect(dirBadge).toHaveText('1');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toBeEnabled();
    await expect(toggleBtn).toHaveText('次の変更 2');
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled();
    await expect(page.locator('#content .diff-changed')).toContainText('Top-level file, updated.');
    await expect(page.locator('#content .diff-removed-inline')).toContainText('Second paragraph');

    // readme.md ITSELF also carries an unread ● now — unreadBadges.js
    // doesn't special-case the active tab (pre-existing 0.6.5 design):
    // readme's own baseline is genuinely stale until 「✓ 確認」 below, so
    // it's exactly as "unread" as note1.md. The header chip counts BOTH
    // (note1.md + readme.md itself).
    await expect(readmeBadge).toHaveClass(/is-unread/);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('2');

    // 0.6.12: disabling Review clears EVERYTHING in one click — badges,
    // chip, toolbar diff controls, and highlights/strikethrough together
    // (nothing underneath was forgotten — background tracking never
    // stopped while Review was briefly ON).
    await toggleReviewMode(page);
    await expect(reviewToggle).not.toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(note1Badge).toHaveCount(0);
    await expect(readmeBadge).toHaveCount(0);
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();
    await expect(toggleBtn).toBeHidden();
    await expect(confirmBtn).toBeHidden();
    await expect(page.locator('#content .diff-added, #content .diff-changed, #content .diff-removed-inline'))
        .toHaveCount(0);

    // Re-enable Review — the rest of this test (pre-existing 0.6.5/0.6.8
    // coverage below: badge lifecycle, header chip cycling, folder
    // bulk-confirm) needs it ON to see anything. Both note1.md and readme.md
    // are STILL genuinely unread (their `_unreadEtag` entries were only ever
    // PAINT-suppressed while Review was off, never cleared) — badges/count/
    // chip reappear with no new edit needed, same for readme's still-pending
    // diff.
    await toggleReviewMode(page);
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toBeEnabled();
    await expect(note1Badge).toHaveClass(/is-unread/);
    await expect(readmeBadge).toHaveClass(/is-unread/);
    await expect(dirBadge).toHaveText('1');
    await expect(chip).toHaveText('2');

    // Confirm readme's own pending diff now — it's outside docs/ and just
    // noise for the folder-scoped assertions below. Confirming also clears
    // readme's own unread ● (markSeen() fires the onSeen seam this module
    // subscribes to, same as any other file), dropping the chip back to 1.
    // 0.6.14: with nothing left to review, the button stays MOUNTED (Review
    // is still ON) but goes `disabled` instead of hiding.
    await confirmBtn.click();
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toBeDisabled();
    await expect(readmeBadge).toHaveCount(0);
    await expect(chip).toHaveText('1');

    // (a) Opening the unread file clears the ● and the folder count
    // disappears (back to 0 unread under docs/). 0.6.8 Word-like declutter
    // (owner): no ✓ replaces it — the badge is simply gone.
    await note1Row.locator(':scope > .tree-item-content').click();
    await expect(page.locator('#content')).toContainText('Externally changed paragraph.');

    await expect(note1Badge).toHaveCount(0, { timeout: 5000 });
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();

    // (b) A brand-new file arriving externally is unread (kind: 'added')
    // as soon as the tree shows it.
    await writeFile(path.join(fixtureDir, NOTE2), '# Note 2\n\nBrand new file.\n', 'utf-8');

    const note2Row = page.locator(`.tree-item[data-path="${NOTE2}"]`);
    await expect(note2Row).toBeVisible({ timeout: 5000 });
    const note2Badge = note2Row.locator(':scope > .tree-item-content > .tree-badge-status');
    await expect(note2Badge).toHaveClass(/is-unread/, { timeout: 5000 });
    await expect(dirBadge).toHaveText('1');

    // (c) The header chip shows the new total; clicking it opens the next
    // unread file (note2.md, the only unread path).
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('1');
    await chip.click();
    await expect(page.locator('#content')).toContainText('Brand new file.');
    // 0.6.8 Word-like declutter (owner): no ✓ badge — assert it's simply gone.
    await expect(note2Badge).toHaveCount(0, { timeout: 5000 });
    await expect(chip).toBeHidden();

    // Set up two unread files under docs/ with DIFFERENT provenance, to
    // exercise both branches of the folder bulk-confirm action:
    //  - note1: re-edited externally -> a 'changed' item, so its unread
    //    entry carries a KNOWN etag.
    //  - note3: a brand-new file -> an 'added' item, so its unread entry
    //    carries NO etag (documented limitation: can't be confirmed
    //    against anything, only cleared from the session set).
    await writeFile(path.join(fixtureDir, NOTE1), '# Note 1\n\nYet another external edit.\n', 'utf-8');
    await writeFile(path.join(fixtureDir, NOTE3), '# Note 3\n\nAlso brand new.\n', 'utf-8');

    const note3Row = page.locator(`.tree-item[data-path="${NOTE3}"]`);
    await expect(note3Row).toBeVisible({ timeout: 5000 });
    const note3Badge = note3Row.locator(':scope > .tree-item-content > .tree-badge-status');

    await expect(note1Badge).toHaveClass(/is-unread/, { timeout: 5000 });
    await expect(note3Badge).toHaveClass(/is-unread/, { timeout: 5000 });
    await expect(dirBadge).toHaveText('2');

    // (d) Directory context menu -> フォルダ内を確認済みにする.
    await dirRow.locator(':scope > .tree-item-content').click({ button: 'right' });
    const menuItem = page.locator('.context-menu-item', { hasText: 'フォルダ内を確認済みにする' });
    await expect(menuItem).toBeVisible();
    await menuItem.click();

    // note1 had a known etag -> genuinely confirmed, note3 arrived as an
    // 'added' item which carries a content etag as of codex rounds 2-4, so
    // folder mark-all can genuinely confirm it too, same as note1. 0.6.8
    // Word-like declutter (owner): neither shows a ✓ — both badges are
    // simply gone (the old "cleared with no badge" distinction between
    // known/unknown etag no longer has a visible difference to assert).
    await expect(note1Badge).toHaveCount(0, { timeout: 5000 });
    await expect(note3Badge).toHaveCount(0, { timeout: 5000 });
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();
});

test('0.6.12: Review mode ON/OFF survives reload (the unread map itself is session-only, an unrelated pre-existing 0.6.5 design choice — see modules/unreadBadges.js\'s docstring)', async ({ page }) => {
    await page.goto(server.baseURL + '/');
    const reviewToggle = page.locator('#reviewModeToggle');
    await expect(reviewToggle).not.toHaveClass(/active/);

    await toggleReviewMode(page);
    await expect(reviewToggle).toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(reviewToggle).toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');

    await toggleReviewMode(page);
    await expect(reviewToggle).not.toHaveClass(/active/);
    await page.reload();
    await expect(reviewToggle).not.toHaveClass(/active/);
    await expect(reviewToggle).toHaveAttribute('aria-pressed', 'false');
});
