import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// modules/unreadBadges.js — 0.6.5 未読●/✓/フォルダバッジ + 次の未読へ. Covers
// the full event-driven lifecycle: an external edit to a file that is NOT
// the active tab lights up its row + parent directory count, opening it
// flips the row to ✓ and decrements the count, a brand-new file arrives
// unread, the sidebar header chip reflects the total and cycles to the
// next unread on click, and the directory context-menu bulk-confirm clears
// everything under it.

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

test.beforeAll(async () => {
    fixtureDir = await makeFixtureDir('mdv-e2e-unread-');
    await seedFiles(fixtureDir, {
        [README]: '# Readme\n\nTop-level file.\n',
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

test('unread badges: external edit lights up a non-open file + its folder, opening it clears both, a new file arrives unread, the header chip cycles, and folder mark-all clears everything', async ({ page }) => {
    await page.goto(server.baseURL + '/');

    // Open readme.md — a first-ever open (no prior baseline) auto-confirms
    // via diffReview.js's first-sight markSeen(), which fires the onSeen
    // seam this module subscribes to: per spec, OPENING a file marks it
    // ✓ immediately (not "no badge") — it also establishes an "active tab"
    // so later "next unread" cycling has somewhere to cycle FROM.
    await page.locator(`.tree-item[data-path="${README}"] [data-action="open"]`).click();
    await expect(page.locator('#content h1')).toHaveText('Readme');
    await waitForBaseline(page, README);

    const readmeBadge = page.locator(`.tree-item[data-path="${README}"] > .tree-item-content > .tree-badge-status`);
    await expect(readmeBadge).toHaveClass(/is-seen/, { timeout: 5000 });
    await expect(readmeBadge).toHaveText('✓');

    const chip = page.locator('#unreadCountChip');
    await expect(chip).toBeHidden();

    // Expand the docs/ directory (root-level dirs are already loaded — see
    // 06-pagination.spec.js — so this only toggles the collapsed class).
    const dirRow = page.locator(`.tree-item[data-path="${DIR}"]`);
    await dirRow.locator(':scope > .tree-item-content').click();

    const note1Row = page.locator(`.tree-item[data-path="${NOTE1}"]`);
    await expect(note1Row).toBeVisible();

    // (a) External edit to a file that is NOT the active tab: its row gets
    // ● and the parent directory gets a count badge of 1.
    await writeFile(path.join(fixtureDir, NOTE1), '# Note 1\n\nExternally changed paragraph.\n', 'utf-8');

    const note1Badge = note1Row.locator(':scope > .tree-item-content > .tree-badge-status');
    await expect(note1Badge).toHaveClass(/is-unread/, { timeout: 5000 });
    await expect(note1Badge).toHaveText('●');

    const dirBadge = dirRow.locator(':scope > .tree-item-content > .tree-badge-count');
    await expect(dirBadge).toHaveText('1');

    // Readme (already confirmed ✓ above) is untouched by note1's change.
    await expect(readmeBadge).toHaveClass(/is-seen/);

    // Header chip reflects the one outstanding unread file.
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('1');

    // (b) Opening the unread file flips ● -> ✓ and the folder count
    // disappears (back to 0 unread under docs/).
    await note1Row.locator(':scope > .tree-item-content').click();
    await expect(page.locator('#content')).toContainText('Externally changed paragraph.');

    await expect(note1Badge).toHaveClass(/is-seen/, { timeout: 5000 });
    await expect(note1Badge).toHaveText('✓');
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();

    // (c) A brand-new file arriving externally is unread (kind: 'added')
    // as soon as the tree shows it.
    await writeFile(path.join(fixtureDir, NOTE2), '# Note 2\n\nBrand new file.\n', 'utf-8');

    const note2Row = page.locator(`.tree-item[data-path="${NOTE2}"]`);
    await expect(note2Row).toBeVisible({ timeout: 5000 });
    const note2Badge = note2Row.locator(':scope > .tree-item-content > .tree-badge-status');
    await expect(note2Badge).toHaveClass(/is-unread/, { timeout: 5000 });
    await expect(dirBadge).toHaveText('1');

    // (d) The header chip shows the new total; clicking it opens the next
    // unread file (note2.md, the only unread path).
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('1');
    await chip.click();
    await expect(page.locator('#content')).toContainText('Brand new file.');
    await expect(note2Badge).toHaveClass(/is-seen/, { timeout: 5000 });
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

    // (e) Directory context menu -> フォルダ内を確認済みにする.
    await dirRow.locator(':scope > .tree-item-content').click({ button: 'right' });
    const menuItem = page.locator('.context-menu-item', { hasText: 'フォルダ内を確認済みにする' });
    await expect(menuItem).toBeVisible();
    await menuItem.click();

    // note1 had a known etag -> genuinely confirmed (✓), not just cleared.
    await expect(note1Badge).toHaveClass(/is-seen/, { timeout: 5000 });
    // note3 arrived as an 'added' item, which carries a content etag as of
    // codex rounds 2-4 — so folder mark-all can genuinely confirm it too
    // (✓), same as note1. (The old "cleared with no badge" expectation only
    // applies to oversized/unreadable adds, which ship without an etag.)
    await expect(note3Badge).toHaveClass(/is-seen/, { timeout: 5000 });
    await expect(dirBadge).toHaveCount(0);
    await expect(chip).toBeHidden();
});
