/**
 * Tests for the office document "vibe preview" feature (xlsx/pptx/docx).
 *
 * Fixture buffers are built in-process with fflate's zipSync/strToU8 —
 * minimal-but-valid OOXML packages (workbook + sheet + sharedStrings for
 * xlsx; a handful of slideN.xml for pptx; word/document.xml for docx).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { strToU8, zipSync } from 'fflate';

import { renderXlsxPreview, renderPptxPreview, renderDocxPreview } from '../src/rendering/office.js';
import { getFileType, isOfficePreviewable } from '../src/utils/fileTypes.js';
import { startTestServer } from './helpers/server.js';

// ============================================================
// Fixture builders
// ============================================================

function xmlDecl(inner) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${inner}`;
}

/** XML-escape text for embedding as element content in a fixture. */
function xesc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CONTENT_TYPES_XML = xmlDecl(
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '</Types>'
);

function relsXml(target) {
  return xmlDecl(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>` +
    '</Relationships>'
  );
}

/**
 * Build a minimal valid .xlsx buffer.
 * @param {{ sheetNames?: string[], sheetXmlBody: string, sharedStrings?: string[] }} opts
 */
function buildXlsxBuffer({ sheetNames = ['Sheet1'], sheetXmlBody, sharedStrings = [] }) {
  const workbookXml = xmlDecl(
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheetNames.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    '</workbook>'
  );

  const sheetXml = xmlDecl(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetXmlBody}</sheetData>` +
    '</worksheet>'
  );

  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(relsXml('xl/workbook.xml')),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  };

  if (sharedStrings.length > 0) {
    const sstXml = xmlDecl(
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      `count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
      `${sharedStrings.map((s) => `<si><t>${xesc(s)}</t></si>`).join('')}</sst>`
    );
    files['xl/sharedStrings.xml'] = strToU8(sstXml);
  }

  return Buffer.from(zipSync(files));
}

/**
 * Build a minimal valid .pptx buffer with one slideN.xml per entry of
 * `slides`, each entry being an array of text runs (first = title, rest =
 * bullets).
 * @param {{ slides: string[][] }} opts
 */
function buildPptxBuffer({ slides }) {
  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(relsXml('ppt/presentation.xml')),
  };

  slides.forEach((runs, i) => {
    const slideXml = xmlDecl(
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:txBody>' +
      runs.map((r) => `<a:p><a:r><a:t>${xesc(r)}</a:t></a:r></a:p>`).join('') +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    );
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml);
  });

  return Buffer.from(zipSync(files));
}

/**
 * Build a minimal valid .docx buffer. Each entry of `paragraphs` is either a
 * string (single run) or an array of strings (multiple runs in one
 * paragraph, joined by the renderer).
 * @param {{ paragraphs: (string|string[])[] }} opts
 */
function buildDocxBuffer({ paragraphs }) {
  const body = paragraphs.map((p) => {
    const runs = Array.isArray(p) ? p : [p];
    return `<w:p>${runs.map((r) => `<w:r><w:t>${xesc(r)}</w:t></w:r>`).join('')}</w:p>`;
  }).join('');

  const documentXml = xmlDecl(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body>` +
    '</w:document>'
  );

  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(relsXml('word/document.xml')),
    'word/document.xml': strToU8(documentXml),
  };

  return Buffer.from(zipSync(files));
}

const BASE_SHEET_ROWS =
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
  '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>InlineHello</t></is></c></row>';

const BASE_SHARED_STRINGS = ['Name', '<script>alert(1)</script>'];

// ============================================================
// fileTypes.js: officePreview flag
// ============================================================

describe('fileTypes: office preview flag', () => {
  it('marks docx/xlsx/pptx as officePreview without changing icon/type/binary', () => {
    for (const ext of ['docx', 'xlsx', 'pptx']) {
      const ft = getFileType(`file.${ext}`);
      assert.strictEqual(ft.type, 'office');
      assert.strictEqual(ft.icon, 'office');
      assert.strictEqual(ft.binary, true);
      assert.strictEqual(ft.officePreview, true);
      assert.strictEqual(isOfficePreviewable(`file.${ext}`), true);
    }
  });

  it('leaves legacy doc/xls/ppt as plain binary (no preview flag)', () => {
    for (const ext of ['doc', 'xls', 'ppt']) {
      const ft = getFileType(`file.${ext}`);
      assert.strictEqual(ft.type, 'office');
      assert.strictEqual(ft.icon, 'office');
      assert.strictEqual(ft.binary, true);
      assert.ok(!ft.officePreview);
      assert.strictEqual(isOfficePreviewable(`file.${ext}`), false);
    }
  });
});

// ============================================================
// renderXlsxPreview
// ============================================================

describe('renderXlsxPreview', () => {
  it('extracts shared-string, inline-string, and numeric cell text', () => {
    const buf = buildXlsxBuffer({ sheetXmlBody: BASE_SHEET_ROWS, sharedStrings: BASE_SHARED_STRINGS });
    const { html, kind } = renderXlsxPreview(buf);

    assert.strictEqual(kind, 'xlsx');
    assert.match(html, /office-preview-banner/);
    assert.match(html, /office-preview-table/);
    assert.ok(html.includes('Name'), 'shared string header cell');
    assert.ok(html.includes('42'), 'numeric cell');
    assert.ok(html.includes('InlineHello'), 'inline string cell');
  });

  it('escapes a cell containing markup instead of rendering it', () => {
    const buf = buildXlsxBuffer({ sheetXmlBody: BASE_SHEET_ROWS, sharedStrings: BASE_SHARED_STRINGS });
    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
    assert.ok(!html.includes('<script>'), 'raw form absent');
  });

  it('lists other sheet names as 「他のシート: ...」', () => {
    const buf = buildXlsxBuffer({
      sheetNames: ['Sheet1', 'Sheet2', 'Sheet3'],
      sheetXmlBody: BASE_SHEET_ROWS,
      sharedStrings: BASE_SHARED_STRINGS,
    });
    const { html } = renderXlsxPreview(buf);

    assert.match(html, /他のシート/);
    assert.ok(html.includes('Sheet2'));
    assert.ok(html.includes('Sheet3'));
  });

  it('omits the sheet-list header for a single-sheet workbook', () => {
    const buf = buildXlsxBuffer({ sheetXmlBody: BASE_SHEET_ROWS, sharedStrings: BASE_SHARED_STRINGS });
    const { html } = renderXlsxPreview(buf);

    assert.ok(!html.includes('他のシート'));
  });

  it('truncates rows beyond maxRows and shows a notice', () => {
    const rows = [];
    for (let r = 1; r <= 10; r++) rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c></row>`);
    const buf = buildXlsxBuffer({ sheetXmlBody: rows.join('') });

    const { html } = renderXlsxPreview(buf, { maxRows: 3, maxCols: 20 });
    const trCount = (html.match(/<tr>/g) || []).length;

    assert.strictEqual(trCount, 3); // 1 header row + 2 body rows
    assert.match(html, /行数が多いため/);
  });

  it('truncates columns beyond maxCols and shows a notice', () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const rowCells = letters.map((l, i) => `<c r="${l}1"><v>${i}</v></c>`).join('');
    const buf = buildXlsxBuffer({ sheetXmlBody: `<row r="1">${rowCells}</row>` });

    const { html } = renderXlsxPreview(buf, { maxRows: 50, maxCols: 3 });
    const thCount = (html.match(/<th>/g) || []).length;

    assert.strictEqual(thCount, 3);
    assert.match(html, /列数が多いため/);
  });

  it('reports an empty sheet without crashing', () => {
    const buf = buildXlsxBuffer({ sheetXmlBody: '' });
    const { html } = renderXlsxPreview(buf);

    assert.match(html, /office-preview-empty/);
  });

  it('throws a coded error for a corrupt zip', () => {
    assert.throws(
      () => renderXlsxPreview(Buffer.from('this is not a zip file at all')),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });

  it('throws a coded error when xl/workbook.xml is missing', () => {
    const buf = Buffer.from(zipSync({ 'hello.txt': strToU8('hi') }));
    assert.throws(
      () => renderXlsxPreview(buf),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });
});

// ============================================================
// renderPptxPreview
// ============================================================

describe('renderPptxPreview', () => {
  it('renders each slide as slide number + title + bullets', () => {
    const buf = buildPptxBuffer({
      slides: [
        ['Title One', 'Bullet A', 'Bullet B'],
        ['Title Two'],
      ],
    });
    const { html, kind } = renderPptxPreview(buf);

    assert.strictEqual(kind, 'pptx');
    assert.match(html, /Slide 1/);
    assert.match(html, /Slide 2/);
    assert.ok(html.includes('Title One'));
    assert.ok(html.includes('Bullet A'));
    assert.ok(html.includes('Bullet B'));
    assert.ok(html.includes('Title Two'));
  });

  it('a slide with a single run gets no bullet list', () => {
    const buf = buildPptxBuffer({ slides: [['Only Title']] });
    const { html } = renderPptxPreview(buf);

    assert.ok(!html.includes('office-preview-slide-bullets'));
  });

  it('sorts slides numerically (slide10 after slide2, not lexicographically)', () => {
    const files = {
      'ppt/slides/slide1.xml': strToU8(xmlDecl(
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
      )),
      'ppt/slides/slide2.xml': strToU8(xmlDecl(
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
      )),
      'ppt/slides/slide10.xml': strToU8(xmlDecl(
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
      )),
    };
    const buf = Buffer.from(zipSync(files));
    const { html } = renderPptxPreview(buf);

    const firstIdx = html.indexOf('First');
    const secondIdx = html.indexOf('Second');
    const tenthIdx = html.indexOf('Tenth');

    assert.ok(firstIdx >= 0 && secondIdx > firstIdx && tenthIdx > secondIdx);
  });

  it('truncates slides beyond maxSlides and shows a notice', () => {
    const slides = Array.from({ length: 5 }, (_, i) => [`Title ${i + 1}`]);
    const buf = buildPptxBuffer({ slides });

    const { html } = renderPptxPreview(buf, { maxSlides: 2 });

    assert.ok(html.includes('Title 1'));
    assert.ok(html.includes('Title 2'));
    assert.ok(!html.includes('Title 3'));
    assert.match(html, /スライドが多いため/);
  });

  it('throws a coded error for a corrupt zip', () => {
    assert.throws(
      () => renderPptxPreview(Buffer.from('not a zip')),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });

  it('throws a coded error when no slides are present', () => {
    const buf = Buffer.from(zipSync({ 'hello.txt': strToU8('hi') }));
    assert.throws(
      () => renderPptxPreview(buf),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });
});

// ============================================================
// renderDocxPreview
// ============================================================

describe('renderDocxPreview', () => {
  it('renders each paragraph as its own <p>, joining multi-run paragraphs', () => {
    const buf = buildDocxBuffer({
      paragraphs: [
        'First paragraph text.',
        ['Second paragraph, ', 'with multiple runs.'],
      ],
    });
    const { html, kind } = renderDocxPreview(buf);

    assert.strictEqual(kind, 'docx');
    assert.ok(html.includes('First paragraph text.'));
    assert.ok(html.includes('Second paragraph, with multiple runs.'));
  });

  it('escapes markup inside paragraph text', () => {
    const buf = buildDocxBuffer({ paragraphs: ['<b>bold?</b>'] });
    const { html } = renderDocxPreview(buf);

    assert.ok(html.includes('&lt;b&gt;'));
    assert.ok(!html.includes('<b>bold?</b>'));
  });

  it('truncates paragraphs beyond maxParagraphs and shows a notice', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}`);
    const buf = buildDocxBuffer({ paragraphs });

    const { html } = renderDocxPreview(buf, { maxParagraphs: 3 });

    assert.ok(html.includes('Paragraph 1'));
    assert.ok(html.includes('Paragraph 3'));
    assert.ok(!html.includes('Paragraph 4'));
    assert.match(html, /段落が多いため/);
  });

  it('throws a coded error for a corrupt zip', () => {
    assert.throws(
      () => renderDocxPreview(Buffer.from('not a zip')),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });

  it('throws a coded error when word/document.xml is missing', () => {
    const buf = Buffer.from(zipSync({ 'hello.txt': strToU8('hi') }));
    assert.throws(
      () => renderDocxPreview(buf),
      (err) => err.code === 'OFFICE_PREVIEW_FAILED'
    );
  });
});

// ============================================================
// GET /api/file integration
// ============================================================

describe('GET /api/file — office preview integration', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'report.xlsx': buildXlsxBuffer({ sheetXmlBody: BASE_SHEET_ROWS, sharedStrings: BASE_SHARED_STRINGS }),
        'legacy.xls': Buffer.from('not really an xls, just some bytes'),
        'corrupt.xlsx': Buffer.from('this is not a zip file at all'),
      },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('returns a rendered preview for a small, valid xlsx', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/file?path=report.xlsx`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.fileType, 'office');
    assert.strictEqual(data.icon, 'office');
    assert.ok(data.downloadUrl);
    assert.ok(data.content.includes('office-preview-banner'));
    assert.ok(data.content.includes('InlineHello'));
  });

  it('falls back to the plain binary card for a legacy .xls file', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/file?path=legacy.xls`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.fileType, 'office');
    assert.strictEqual(data.icon, 'office');
    assert.strictEqual(data.content, undefined);
    assert.ok(data.downloadUrl);
  });

  it('falls back to the plain binary card when the xlsx is actually corrupt', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/file?path=corrupt.xlsx`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.fileType, 'office');
    assert.strictEqual(data.content, undefined);
    assert.ok(data.downloadUrl);
  });
});
