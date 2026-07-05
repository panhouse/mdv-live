import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

// mdv.config.json's css/pdfOptions flow: CLI loads the config and passes
// pdfStyleDefaults to createMdvServer -> /api/info -> the Style panel is
// prefilled when the user has no stored (localStorage) choice. This spec
// exercises the server->frontend half with the same option shape the CLI
// sends; the CLI->server half is covered by unit tests.

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-configstyle-');
  await seedFiles(fixtureDir, {
    'doc.md': '# 設定スタイル\n\n本文\n',
    'report.css': 'h1 { letter-spacing: 0.2em; }\n'
  });
  server = await startServer(fixtureDir, {
    pdfStyleDefaults: { css: 'report.css' }
  });
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('config-style: the PDF style panel is prefilled from mdv.config.json defaults', async ({ page }) => {
  await page.goto(server.baseURL + '/');
  await expect(page.locator('.tree-item[data-path="doc.md"] .name')).toBeVisible();

  await page.locator('#pdfStyleToggle').click();
  await expect(page.locator('#pdfStylePanel')).toBeVisible();
  await expect(page.locator('#pdfStylePath')).toHaveValue('report.css');

  // A user choice stored in localStorage must win over the config default.
  await page.locator('#pdfStylePath').fill('mine.css');
  await page.locator('#pdfStyleApply').click();
  await page.reload();
  await page.locator('#pdfStyleToggle').click();
  await expect(page.locator('#pdfStylePath')).toHaveValue('mine.css');
});
