import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-search-');
  await seedFiles(fixtureDir, {
    // Top-level file with two hits (Japanese content).
    '01-notes.md': [
      '# 議事録',
      '',
      '単価は135万円です。',
      '',
      '次回までに単価改定の資料を用意します。'
    ].join('\n') + '\n',
    // No hits — proves the query doesn't match everything.
    'plain.md': '# Unrelated\n\nNo matches in this file.\n',
    // One hit inside a subdirectory, deep inside a LONG document. The
    // length is load-bearing: TabManager.renderActive() restores the
    // remembered scrollTop via setTimeout(0), and an unsuppressed restore
    // yanks the pane back to the top AFTER the search jump (codex review
    // finding) — only a hit far below the fold catches that regression.
    'docs/sub/estimate.md': [
      '# 見積書',
      '',
      ...Array.from({ length: 120 }, (_, i) => `前段の埋め草パラグラフ ${i + 1} 行目。\n`),
      'エンジニア単価は135万円/月とする。'
    ].join('\n') + '\n'
  });
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('search palette: Cmd/Ctrl+K opens, debounced query renders grouped highlighted results, Enter jumps to the hit, Esc closes', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  const overlay = page.locator('#searchPaletteOverlay');
  await expect(overlay).toBeHidden();

  // Open via the global keyboard shortcut (metaKey||ctrlKey — see
  // keyboard.js's shortcuts table; existing specs, e.g. 03-edit-save,
  // establish that 'Meta+<key>' reaches the app's metaKey||ctrlKey check
  // in this CI environment).
  await page.keyboard.press('Meta+k');
  await expect(overlay).toBeVisible();

  const input = page.locator('#searchPaletteInput');
  await expect(input).toBeFocused();

  await input.fill('単価');

  // Debounced ~200ms (SEARCH_DEBOUNCE_MS) — wait for the grouped results.
  const groups = page.locator('#searchPaletteResults .search-group');
  await expect(groups).toHaveCount(2, { timeout: 5000 });
  await expect(groups.nth(0)).toContainText('01-notes.md');
  await expect(groups.nth(1)).toContainText('docs/sub/estimate.md');

  const hits = page.locator('#searchPaletteResults .search-hit');
  await expect(hits).toHaveCount(3);

  // <mark> highlighting on the matched substring, escaped via the app's
  // existing escapeHtml (no innerHTML of raw server text).
  await expect(hits.first().locator('mark')).toHaveText('単価');

  // First hit is pre-selected.
  await expect(hits.first()).toHaveClass(/selected/);

  // Footer shows hit/file counts.
  const footer = page.locator('#searchPaletteFooter');
  await expect(footer).toContainText('3件');
  await expect(footer).toContainText('2ファイル');

  // Move selection down to the subdirectory hit (index 2) with the keyboard.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(hits.nth(2)).toHaveClass(/selected/);
  await expect(hits.nth(0)).not.toHaveClass(/selected/);

  await page.keyboard.press('Enter');

  // The palette closes and the correct tab (the subdirectory file) opens.
  await expect(overlay).toBeHidden();
  const activeTab = page.locator('#tabBar .tab.active');
  await expect(activeTab).toContainText('estimate.md');

  // The matching block — deep below 120 filler paragraphs, so an
  // unsuppressed scroll-restore racing the jump would leave it far
  // off-screen — is scrolled into the viewport and flash-highlighted.
  // Located by hit text, not a hardcoded source line.
  const targetBlock = page.locator('#content [data-source-line]', { hasText: 'エンジニア単価は135万円/月とする。' });
  await expect(targetBlock).toBeInViewport();
  await expect(targetBlock).toHaveClass(/search-jump-flash/);
  // The flash class is temporary (SEARCH_JUMP_FLASH_MS ~1.5s) — it must
  // eventually clear on its own.
  await expect(targetBlock).not.toHaveClass(/search-jump-flash/, { timeout: 3000 });

  // Re-open, type a different query, and Esc closes without navigating.
  await page.keyboard.press('Meta+k');
  await expect(overlay).toBeVisible();
  await page.locator('#searchPaletteInput').fill('見積');
  await expect(page.locator('#searchPaletteResults .search-hit')).toHaveCount(1, { timeout: 5000 });

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  // Esc must not have navigated away from the tab opened above.
  await expect(page.locator('#tabBar .tab.active')).toContainText('estimate.md');
});

test('search palette: toolbar search box also opens the palette, and a short query shows a hint instead of searching', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  const overlay = page.locator('#searchPaletteOverlay');
  await expect(overlay).toBeHidden();

  await page.locator('#searchBoxToggle').click();
  await expect(overlay).toBeVisible();

  const input = page.locator('#searchPaletteInput');
  await input.fill('単');
  await expect(page.locator('#searchPaletteResults .search-hint')).toBeVisible();
  await expect(page.locator('#searchPaletteResults .search-hit')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});
