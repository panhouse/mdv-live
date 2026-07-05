import { test, expect } from '@playwright/test';
import { makeFixtureDir, seedFiles, startServer, removeFixtureDir } from './helpers.js';

let fixtureDir;
let server;

const TOTAL_FILES = 550;
const CAP = 500; // MAX_CHILDREN_PER_DIR in src/api/tree.js

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-pagination-');

  const files = {};
  for (let i = 1; i <= TOTAL_FILES; i++) {
    const name = `file${String(i).padStart(4, '0')}.md`;
    files[`many/${name}`] = `# ${name}\n`;
  }
  await seedFiles(fixtureDir, files);

  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('pagination: a directory with 550 files caps at 500 rows plus a load-more row', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  const dirNode = page.locator('.tree-item[data-path="many"]');
  await expect(dirNode).toBeVisible();

  // Expand the directory (root-level directories are loaded eagerly, so this
  // just toggles the collapsed CSS class — no extra network round trip).
  await dirNode.locator(':scope > .tree-item-content').click();

  const childrenBox = dirNode.locator(':scope > .tree-children');
  const fileRows = childrenBox.locator(':scope > .tree-item');
  const moreRow = childrenBox.locator(':scope > .tree-more');

  await expect(fileRows).toHaveCount(CAP);
  await expect(moreRow).toHaveCount(1);
  await expect(moreRow).toContainText(`残り ${TOTAL_FILES - CAP} 件`);

  // Load the remaining rows.
  await moreRow.click();

  await expect(fileRows).toHaveCount(TOTAL_FILES);
  await expect(moreRow).toHaveCount(0);
});
