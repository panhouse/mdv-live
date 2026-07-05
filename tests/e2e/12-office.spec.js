import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { makeFixtureDir, startServer, removeFixtureDir } from './helpers.js';

// Office "vibe preview" (xlsx/pptx/docx quick preview, user request 2026-07:
// "パワポとかエクセルは完全表示でなくていいから雰囲気が見えると嬉しい"). Builds
// a minimal-but-valid .xlsx in-process (same fflate zipSync technique as
// tests/test-office-preview.js) and drops it straight into the fixture dir —
// no committed binary fixture needed for this one.

function xmlDecl(inner) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${inner}`;
}

function buildXlsxBuffer() {
  const workbookXml = xmlDecl(
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>'
  );
  const sheetXml = xmlDecl(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12345</v></c></row>' +
    '</sheetData></worksheet>'
  );
  const sstXml = xmlDecl(
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">' +
    '<si><t>Product</t></si><si><t>Price</t></si><si><t>MDV-DEMO-CELL</t></si>' +
    '</sst>'
  );

  const files = {
    '[Content_Types].xml': strToU8(xmlDecl(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '</Types>'
    )),
    '_rels/.rels': strToU8(xmlDecl(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
    )),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    'xl/sharedStrings.xml': strToU8(sstXml),
  };

  return Buffer.from(zipSync(files));
}

let fixtureDir;
let server;

test.beforeAll(async () => {
  fixtureDir = await makeFixtureDir('mdv-e2e-office-');
  await writeFile(path.join(fixtureDir, 'demo.xlsx'), buildXlsxBuffer());
  await writeFile(path.join(fixtureDir, 'legacy.xls'), Buffer.from('legacy binary xls bytes, not a real OLE2 file'));
  server = await startServer(fixtureDir);
});

test.afterAll(async () => {
  await server.stop();
  await removeFixtureDir(fixtureDir);
});

test('office: an xlsx opens from the tree and shows a table preview + banner', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await expect(page.locator('.tree-item[data-path="demo.xlsx"] .name')).toBeVisible();
  await page.locator('.tree-item[data-path="demo.xlsx"] [data-action="open"]').click();

  await expect(page.locator('#content .office-preview-banner')).toBeVisible();
  await expect(page.locator('#content .office-preview-table')).toBeVisible();
  await expect(page.locator('#content .office-preview-table')).toContainText('MDV-DEMO-CELL');
  await expect(page.locator('#content .office-preview-table')).toContainText('12345');

  // Download link stays visible for the "real thing" (元アプリで見る).
  await expect(page.locator('#content a.preview-download-btn')).toBeVisible();
});

test('office: a legacy .xls file still shows the plain binary download card', async ({ page }) => {
  await page.goto(server.baseURL + '/');

  await expect(page.locator('.tree-item[data-path="legacy.xls"] .name')).toBeVisible();
  await page.locator('.tree-item[data-path="legacy.xls"] [data-action="open"]').click();

  await expect(page.locator('#content .binary-preview')).toBeVisible();
  await expect(page.locator('#content .office-preview-banner')).toHaveCount(0);
});
