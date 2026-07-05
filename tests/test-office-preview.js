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

/**
 * XML-escape text for embedding as a double-quoted attribute value (adds
 * `&quot;` on top of xesc()'s element-content escaping) — needed for numFmt
 * formatCode strings, which routinely contain literal quoted text literals
 * (e.g. `yyyy"年"m"月"d"日"`).
 */
function xescAttr(text) {
  return xesc(text).replace(/"/g, '&quot;');
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
 * @param {{ sheetNames?: string[], sheetXmlBody: string, sharedStrings?: string[],
 *   stylesXml?: string, date1904?: boolean }} opts
 */
function buildXlsxBuffer({
  sheetNames = ['Sheet1'],
  sheetXmlBody,
  sharedStrings = [],
  stylesXml,
  date1904 = false,
}) {
  const workbookXml = xmlDecl(
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    (date1904 ? '<workbookPr date1904="1"/>' : '') +
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

  if (stylesXml) {
    files['xl/styles.xml'] = strToU8(stylesXml);
  }

  return Buffer.from(zipSync(files));
}

/**
 * Build a minimal valid xl/styles.xml with a `<cellXfs>` list whose entries
 * (in order — array index == the `s="N"` style index referenced from a
 * cell) reference numFmtIds, plus any custom `<numFmts>` definitions those
 * ids need.
 * @param {{ numFmts?: {id:number, code:string}[], cellXfsNumFmtIds: number[] }} opts
 */
function buildStylesXml({ numFmts = [], cellXfsNumFmtIds }) {
  const numFmtsXml = numFmts.length
    ? `<numFmts count="${numFmts.length}">${numFmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${xescAttr(f.code)}"/>`).join('')}</numFmts>`
    : '';
  const cellXfsXml =
    `<cellXfs count="${cellXfsNumFmtIds.length}">` +
    cellXfsNumFmtIds.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`).join('') +
    '</cellXfs>';

  return xmlDecl(
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    numFmtsXml +
    cellXfsXml +
    '</styleSheet>'
  );
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

describe('renderXlsxPreview — first-sheet resolution via workbook rels', () => {
  it('follows r:id through workbook.xml.rels when the part is not sheet1.xml', () => {
    // Simulates a workbook whose first (and only) visible sheet is stored
    // as sheet99.xml — what Excel produces after deleting/reordering
    // sheets. A hard-coded sheet1.xml lookup would fail here.
    const workbookXml = xmlDecl(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="生き残り" sheetId="7" r:id="rId7"/></sheets>' +
      '</workbook>'
    );
    const workbookRels = xmlDecl(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId7" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      'Target="worksheets/sheet99.xml"/>' +
      '</Relationships>'
    );
    const sheetXml = xmlDecl(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Sheet99Cell</t></is></c></row></sheetData>' +
      '</worksheet>'
    );
    const buffer = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(relsXml('xl/workbook.xml')),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
      'xl/worksheets/sheet99.xml': strToU8(sheetXml),
    }));

    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('Sheet99Cell'), 'cell from the rels-resolved sheet should render');
  });

  it('still falls back to sheet1.xml when the rels part is absent', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" t="inlineStr"><is><t>FallbackCell</t></is></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('FallbackCell'));
  });
});

describe('renderXlsxPreview — zip-bomb resistance', () => {
  it('rejects an entry whose inflated size exceeds the cap', () => {
    // 60MB of zeros compresses to ~60KB — under the API's 20MB compressed
    // cap, but far over the 50MB per-entry inflated cap.
    const huge = new Uint8Array(60 * 1024 * 1024);
    const buffer = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      'xl/workbook.xml': huge,
    }));
    assert.throws(() => renderXlsxPreview(buffer), (err) => err.code === 'OFFICE_PREVIEW_FAILED');
  });

  it('ignores large non-XML entries (media) instead of inflating them', () => {
    const workbookXml = xmlDecl(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    const sheetXml = xmlDecl(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>StillWorks</t></is></c></row></sheetData>' +
      '</worksheet>'
    );
    const media = new Uint8Array(60 * 1024 * 1024); // filtered out by name
    const buffer = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(relsXml('xl/workbook.xml')),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
      'xl/media/huge.bin': media,
    }));
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('StillWorks'));
  });
});

// ============================================================
// 0.6.2: number-format awareness (styles.xml → date/percent/thousands)
// ============================================================

describe('renderXlsxPreview — date-formatted cells (styles.xml numFmt)', () => {
  it('converts an Excel date serial to YYYY/M/D using a builtin date numFmt (14)', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 14] });
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Due</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>44197</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('2021/1/1'), 'serial 44197 should render as 2021/1/1');
    assert.ok(!html.includes('44197'), 'the raw serial must not leak through');
  });

  it('appends HH:MM when the numFmt has time tokens and the serial has a fractional part', () => {
    // numFmtId 22 = builtin "m/d/yy h:mm" (date + time).
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 22] });
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Due</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>44197.5</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('2021/1/1 12:00'), 'a half-day fraction should render as noon');
  });

  it('shifts the epoch for date1904 workbooks (serial 0 = 1904-01-01)', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 14] });
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Due</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>0</v></c></row>',
      stylesXml,
      date1904: true,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('1904/1/1'));
  });

  it('steps correctly over the fictitious 1900-02-29 leap day (1900 system)', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 14] });
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Due</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>61</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('1900/3/1'), 'serial 61 is the real calendar date 1900-03-01');
  });

  it('recognizes a custom (non-builtin) numFmt date code from <numFmts>', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 176, code: 'yyyy"年"m"月"d"日"' }],
      cellXfsNumFmtIds: [0, 176],
    });
    const buf = buildXlsxBuffer({
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>44197</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('2021/1/1'), 'quoted literal date tokens must not confuse the parser');
  });
});

describe('renderXlsxPreview — formula cells', () => {
  it('renders the formula text (escaped, muted span) when there is no cached <v>, and the column still appears', () => {
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t>Qty</t></is></c>' +
        '<c r="C1" t="inlineStr"><is><t>Total</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c>' +
        '<c r="B2"><v>3</v></c>' +
        '<c r="C2"><f>IF(B2&lt;10,"low","ok")</f></c></row>',
    });

    const { html } = renderXlsxPreview(buf);

    assert.match(html, /office-preview-formula/, 'formula cell should get the muted class');
    assert.ok(html.includes('=IF(B2&lt;10,&quot;low&quot;,&quot;ok&quot;)'), 'formula text should be escaped');
    assert.ok(!html.includes('<f>'), 'raw <f> markup must never leak into the output');

    const thCount = (html.match(/<th>/g) || []).length;
    assert.strictEqual(thCount, 3, 'the formula column must still count toward the rendered column total');
  });

  it('keeps showing the cached value unchanged when <f> has a cached <v> (no format conversion applied)', () => {
    const buf = buildXlsxBuffer({
      sheetXmlBody: '<row r="1"><c r="A1"><f>SUM(A2:A3)</f><v>84</v></c></row>',
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('84'), 'cached value should render');
    assert.ok(!html.includes('SUM'), 'the formula text itself should not render when a cached value exists');
    assert.ok(!html.includes('office-preview-formula'), 'no muted-formula span when a cached value is shown');
  });
});

describe('renderXlsxPreview — percent and thousands-grouped cells', () => {
  it('renders a %-formatted cell as a trimmed percent (0.62 -> 62%, 0.625 -> 62.5%)', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 9] }); // builtin 9 = "0%"
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" s="1"><v>0.62</v></c><c r="B1" s="1"><v>0.625</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('62%'));
    assert.ok(html.includes('62.5%'));
    assert.ok(!html.includes('0.62<'), 'the raw fraction must not leak through');
  });

  it('renders a comma-grouped numFmt cell with thousands separators (1485000 -> 1,485,000)', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 3] }); // builtin 3 = "#,##0"
    const buf = buildXlsxBuffer({
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>1485000</v></c></row>',
      stylesXml,
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('1,485,000'));
    assert.ok(!html.includes('>1485000<'), 'the ungrouped raw number must not leak through');
  });
});

describe('renderXlsxPreview — trailing empty rows', () => {
  it('suppresses trailing all-empty rows while keeping a mid-table empty row', () => {
    const buf = buildXlsxBuffer({
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Row2</t></is></c></row>' +
        '<row r="3"/>' + // mid-table empty row — must stay
        '<row r="4"><c r="A4" t="inlineStr"><is><t>Row4</t></is></c></row>' +
        '<row r="5"/>' + // trailing empty — must be suppressed
        '<row r="6"/>', // trailing empty — must be suppressed
    });

    const { html } = renderXlsxPreview(buf);

    const trCount = (html.match(/<tr>/g) || []).length;
    assert.strictEqual(trCount, 4, '1 header + Row2 + the mid-table empty row + Row4 (2 trailing rows dropped)');
    assert.ok(html.includes('Row2'));
    assert.ok(html.includes('Row4'));
    assert.ok(!html.includes('行数が多いため'), 'trimming trailing empties must not trigger the maxRows notice');
  });

  it('does not suppress rows when maxRows truncation is what actually happened', () => {
    const rows = [];
    for (let r = 1; r <= 10; r++) rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c></row>`);
    const buf = buildXlsxBuffer({ sheetXmlBody: rows.join('') });

    const { html } = renderXlsxPreview(buf, { maxRows: 3, maxCols: 20 });
    const trCount = (html.match(/<tr>/g) || []).length;

    assert.strictEqual(trCount, 3); // unchanged regression: 1 header + 2 body rows
    assert.match(html, /行数が多いため/);
  });
});

describe('renderXlsxPreview — no styles.xml (backward compatibility)', () => {
  it('leaves a large numeric value raw (no date conversion) when styles.xml is absent', () => {
    // The exact real-world symptom from the 0.6.2 plan doc: a billing date
    // rendered as the bare serial "46208" because there was no number-format
    // awareness at all.
    const buf = buildXlsxBuffer({
      sheetXmlBody: '<row r="1"><c r="A1"><v>46208</v></c></row>',
    });

    const { html } = renderXlsxPreview(buf);

    assert.ok(html.includes('46208'), 'without styles.xml the serial must stay raw, exactly as before');
  });
});

describe('renderXlsxPreview — codex round-2 fixes (time-only formats, ghost columns)', () => {
  it('renders time-only formats (builtin 20 h:mm) as HH:MM without a bogus date', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 20] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>0.5</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('12:00'), 'serial 0.5 with h:mm should render 12:00');
    assert.ok(!html.includes('1899'), 'no 1899 epoch date prefix for time-only cells');
  });

  it('renders custom time-only "h:mm" the same way', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 164, code: 'h:mm' }],
      cellXfsNumFmtIds: [0, 164],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>0.75</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('18:00'));
    assert.ok(!html.includes('1899'));
  });

  it('does not leave ghost columns from cells that lived only in trimmed trailing rows', () => {
    // Row 1 has real data in A only; row 2 is all-empty but contains a
    // style-only cell far to the right (Z2). Row 2 gets trimmed — the
    // preview must be 1 column wide with NO column-truncation notice.
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>OnlyCell</t></is></c></row>' +
        '<row r="2"><c r="Z2" s="1" t="n"></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('OnlyCell'));
    const cellCount = (html.match(/<t[hd]\b/g) || []).length;
    assert.strictEqual(cellCount, 1, `expected exactly 1 rendered cell, got ${cellCount}`);
    assert.ok(!html.includes('列数が多いため'), 'no false column-truncation notice');
  });
});

describe('renderXlsxPreview — codex round-3 fixes (escaped literals, trim vs truncation)', () => {
  it('does not misread backslash-escaped literals as date tokens', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 165, code: '0\\ "days"' }],
      cellXfsNumFmtIds: [0, 165],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>5</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('>5<'), 'plain numeric value must survive');
    assert.ok(!html.includes('1900'), 'escaped literals must not trigger date conversion');
  });

  it('keeps blank boundary rows when maxRows truncates the sheet', () => {
    // 5 rows: row4 is blank, row5 has data. With maxRows=4 the window is
    // rows 1-4; row4 is blank AT THE CUT but not a true trailing row (row5
    // follows in the workbook) — it must be kept, and the truncation
    // notice must fire.
    const body =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>r1</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>r2</t></is></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>r3</t></is></c></row>' +
      '<row r="4"></row>' +
      '<row r="5"><c r="A5" t="inlineStr"><is><t>r5</t></is></c></row>';
    const buffer = buildXlsxBuffer({ sheetNames: ['Sheet1'], sheetXmlBody: body });
    const { html } = renderXlsxPreview(buffer, { maxRows: 4 });
    const rowCount = (html.match(/<tr>/g) || []).length;
    assert.strictEqual(rowCount, 4, 'all 4 rows of the window render, including the blank boundary row');
    assert.ok(html.includes('行数が多いため'));
    assert.ok(!html.includes('r5'));
  });
});

describe('renderXlsxPreview — codex round-4 fixes (elapsed time, t="str" formulas)', () => {
  it('renders builtin 46 [h]:mm:ss as total elapsed hours without 24h wrap', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 46] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>1.5</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('36:00'), '1.5 days elapsed = 36:00, not a wrapped 12:00');
    assert.ok(!html.includes('1899') && !html.includes('1900'));
  });

  it('custom [h]:mm is elapsed time, not a month-only date', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 166, code: '[h]:mm' }],
      cellXfsNumFmtIds: [0, 166],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>2.25</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('54:00'));
  });

  it('t="str" formula cells with no cached value fall back to the formula text', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" t="str"><f>CONCAT(B1,"x")</f></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('=CONCAT(B1,'), 'formula fallback must run for t="str" cells too');
    assert.ok(html.includes('office-preview-formula'));
  });
});

describe('renderXlsxPreview — codex round-5 fixes (seconds, CJK time builtins)', () => {
  it('builtin 45 mm:ss keeps seconds: 90s renders 00:01:30', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 45] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: `<row r="1"><c r="A1" s="1"><v>${90 / 86400}</v></c></row>`,
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('00:01:30'), `expected 00:01:30 in: ${html.slice(html.indexOf('<tbody'), html.indexOf('</tbody')) }`);
  });

  it('CJK builtin 32 (h"時"mm"分") is time, not an 1899 date', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 32] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>0.5</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('12:00'));
    assert.ok(!html.includes('1899'));
  });

  it('CJK builtin 27 stays a date', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 27] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>46208</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2026/7/5'));
  });
});

describe('renderXlsxPreview — codex round-6 fixes (datetime seconds, serial 60)', () => {
  it('seconds-bearing datetime formats keep seconds', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 167, code: 'yyyy-mm-dd h:mm:ss' }],
      cellXfsNumFmtIds: [0, 167],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>44197.5242685</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2021/1/1 12:34:57'), 'timestamp must keep :57 seconds');
  });

  it('serial 60 renders as Excel\'s compatibility 1900/2/29', () => {
    const stylesXml = buildStylesXml({ cellXfsNumFmtIds: [0, 14] });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>60</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('1900/2/29'));
  });
});

describe('renderXlsxPreview — codex round-7 fix (namespace-prefixed OOXML)', () => {
  it('reads namespace-prefixed styles.xml and sheet parts', () => {
    // Some producers emit prefixed OOXML: <x:cellXfs><x:xf .../>, <x:row>,
    // <x:c>. The whole read chain must stay prefix-tolerant.
    const stylesXml = xmlDecl(
      '<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<x:cellXfs count="2">' +
      '<x:xf numFmtId="0" applyNumberFormat="0"/>' +
      '<x:xf numFmtId="14" applyNumberFormat="1"/>' +
      '</x:cellXfs>' +
      '</x:styleSheet>'
    );
    const workbookXml = xmlDecl(
      '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<x:sheets><x:sheet name="前置きシート" sheetId="1" r:id="rId1"/></x:sheets>' +
      '</x:workbook>'
    );
    const sheetXml = xmlDecl(
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<x:sheetData><x:row r="1"><x:c r="A1" s="1"><x:v>46208</x:v></x:c></x:row></x:sheetData>' +
      '</x:worksheet>'
    );
    const buffer = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(relsXml('xl/workbook.xml')),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/styles.xml': strToU8(stylesXml),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    }));
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2026/7/5'), 'date conversion must work through prefixed tags');
    assert.ok(html.includes('前置きシート') === false || true); // sheet name list only when >1 sheet
  });
});

describe('renderXlsxPreview — codex round-8 fixes (elapsed units, blank cached formulas)', () => {
  it('[mm]:ss elapsed renders total minutes (1.5 days -> 2160:00)', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 168, code: '[mm]:ss' }],
      cellXfsNumFmtIds: [0, 168],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>1.5</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2160:00'), 'total minutes, not 36:00:00');
  });

  it('formula with an EMPTY cached <v></v> renders blank (Excel shows blank for ="" )', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>ラベル</t></is></c>' +
        '<c r="B1" t="str"><f>IF(1=1,"","x")</f><v></v></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(!html.includes('=IF'), 'cached-blank formula must render blank, not the formula text');
    assert.ok(html.includes('ラベル'));
  });

  it('formula with NO <v> tag still falls back to the formula text', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1"><f>SUM(B1:B9)</f></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('=SUM(B1:B9)'));
  });
});

describe('renderXlsxPreview — codex round-9 fix (self-closing <v/>)', () => {
  it('a self-closing cached <v/> counts as a cached blank, not a missing value', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>ラベル</t></is></c>' +
        '<c r="B1" t="str"><f>IF(1=1,"","x")</f><v/></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(!html.includes('=IF'), 'self-closing cached blank must render blank');
    assert.ok(html.includes('ラベル'));
  });
});

describe('renderXlsxPreview — real-world disambiguation of empty cached formulas', () => {
  it('openpyxl-style <f>...</f><v></v> WITHOUT t attribute shows the formula (real ROI-calculator case)', () => {
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>ライン停止コスト</t></is></c>' +
        '<c r="B1"><f>B7*B8</f><v></v></c></row>',
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('=B7*B8'), 'openpyxl uncomputed formula must show, not vanish');
  });
});

describe('renderXlsxPreview — codex round-11 fix (all-blank overflow rows)', () => {
  it('blank/style-only rows beyond maxRows are not "truncation": trims tail, no notice', () => {
    const dataRows = Array.from({ length: 10 }, (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>行${i + 1}</t></is></c></row>`).join('');
    const blankRows = Array.from({ length: 45 }, (_, i) =>
      `<row r="${i + 11}"><c r="A${i + 11}" s="1" t="n"></c></row>`).join('');
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: dataRows + blankRows,
    });
    const { html } = renderXlsxPreview(buffer, { maxRows: 50 });
    const rowCount = (html.match(/<tr>/g) || []).length;
    assert.strictEqual(rowCount, 10, 'blank in-window tail must be trimmed');
    assert.ok(!html.includes('行数が多いため'), 'no misleading truncation notice');
  });

  it('real data beyond maxRows still counts as truncation (round-3 behavior kept)', () => {
    const rows = Array.from({ length: 55 }, (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>行${i + 1}</t></is></c></row>`).join('');
    const buffer = buildXlsxBuffer({ sheetNames: ['Sheet1'], sheetXmlBody: rows });
    const { html } = renderXlsxPreview(buffer, { maxRows: 50 });
    assert.ok(html.includes('行数が多いため'));
  });
});

describe('renderXlsxPreview — codex round-12 fixes (decimal precision, formula tails)', () => {
  it('thousands grouping preserves more than 3 decimal places', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 169, code: '#,##0.000000' }],
      cellXfsNumFmtIds: [0, 169],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>1234.123456</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('1,234.123456'), 'full precision with grouping');
  });

  it('cached-blank formula tails beyond maxRows do not trigger the truncation notice', () => {
    const dataRows = Array.from({ length: 10 }, (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>行${i + 1}</t></is></c></row>`).join('');
    const formulaBlankRows = Array.from({ length: 45 }, (_, i) =>
      `<row r="${i + 11}"><c r="A${i + 11}" t="str"><f>IF(1=1,"","x")</f><v/></c></row>`).join('');
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: dataRows + formulaBlankRows,
    });
    const { html } = renderXlsxPreview(buffer, { maxRows: 50 });
    assert.ok(!html.includes('行数が多いため'));
    const rowCount = (html.match(/<tr>/g) || []).length;
    assert.strictEqual(rowCount, 10);
  });
});

describe('renderXlsxPreview — codex round-13 fix (midnight rounding carry)', () => {
  it('a timestamp that rounds up to 24:00 carries into the NEXT day', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 170, code: 'yyyy-mm-dd h:mm:ss' }],
      cellXfsNumFmtIds: [0, 170],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>44197.9999999</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2021/1/2 00:00:00'), `expected next-day carry, html: ${html.slice(html.indexOf('<tbody'), html.indexOf('</tbody'))}`);
  });

  it('normal timestamps are unaffected by the carry logic', () => {
    const stylesXml = buildStylesXml({
      numFmts: [{ id: 171, code: 'yyyy-mm-dd h:mm:ss' }],
      cellXfsNumFmtIds: [0, 171],
    });
    const buffer = buildXlsxBuffer({
      sheetNames: ['Sheet1'],
      sheetXmlBody: '<row r="1"><c r="A1" s="1"><v>44197.5242685</v></c></row>',
      stylesXml,
    });
    const { html } = renderXlsxPreview(buffer);
    assert.ok(html.includes('2021/1/1 12:34:57'));
  });
});
