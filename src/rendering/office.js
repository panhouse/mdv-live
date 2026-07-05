/**
 * Office document "vibe preview" (雰囲気プレビュー).
 *
 * User request: "パワポとかエクセルは完全表示でなくていいから雰囲気が見えると
 * 嬉しい" (xlsx/pptx/docx don't need pixel-perfect rendering — just enough to
 * see what's inside at a glance). These are OOXML: a zip container of XML
 * parts. We unzip with fflate (already a project dependency, zero-deps) and
 * extract text with tolerant regexes rather than a full XML parser/DOM —
 * these are fixed, well-known shapes (workbook.xml/sheetN.xml/sharedStrings.xml,
 * slideN.xml, document.xml) and a real XML parser is not available
 * dependency-free in Node without pulling in a new package. The regexes are
 * written to tolerate namespace prefixes (`<a:t>`, `<w:t>`, bare `<t>`) and
 * attribute order (`r="A1" t="s"` vs `t="s" r="A1"`) by never assuming a
 * fixed attribute position and by matching tag *local names* regardless of
 * prefix.
 *
 * Every renderer:
 *   - never touches the filesystem (caller passes a Buffer already read)
 *   - returns { html, kind } where html is a fully-escaped, self-contained
 *     `<div class="office-preview">...</div>` fragment
 *   - throws a coded Error (err.code === 'OFFICE_PREVIEW_FAILED') on any
 *     parse failure (corrupt zip, missing required part, password-protected
 *     file, etc.) — it never crashes the process. The caller (src/api/file.js)
 *     catches this and falls back to the plain binary-file response.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { escapeHtml } from '../utils/html.js';

const BANNER_TEXT = '簡易プレビュー — レイアウトは再現されません。正確な表示は元アプリで';

/**
 * Build a coded error for any office-preview parse failure.
 * @param {string} message - Human-readable message (not shown to end users)
 * @param {Error} [cause] - Original error, if any
 * @returns {Error} Error with `.code === 'OFFICE_PREVIEW_FAILED'`
 */
function mkOfficeError(message, cause) {
  const err = new Error(message);
  err.code = 'OFFICE_PREVIEW_FAILED';
  if (cause) err.cause = cause;
  return err;
}

// Zip-bomb guard: the 20MB cap in api/file.js limits the COMPRESSED size,
// but a crafted archive can inflate a few KB into gigabytes and block the
// event loop / exhaust memory inside unzipSync. Only the XML parts the
// renderers actually read are inflated, each entry and the running total
// are capped, and the caps are re-checked against the ACTUAL inflated
// lengths afterwards (central-directory size fields can be forged).
const MAX_ENTRY_INFLATED_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_INFLATED_BYTES = 100 * 1024 * 1024;
const PREVIEW_ENTRY_PATTERN = /\.(?:xml|rels)$/i;

/**
 * Unzip an OOXML buffer (XML/rels parts only, size-capped). Never throws
 * an uncoded error.
 * @param {Buffer|Uint8Array} buffer - Raw file bytes
 * @returns {Record<string, Uint8Array>} Zip entries keyed by path
 */
function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let declaredTotal = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        if (!PREVIEW_ENTRY_PATTERN.test(entry.name)) return false;
        if (entry.originalSize > MAX_ENTRY_INFLATED_BYTES) {
          throw mkOfficeError('Office document part too large to preview');
        }
        declaredTotal += entry.originalSize;
        if (declaredTotal > MAX_TOTAL_INFLATED_BYTES) {
          throw mkOfficeError('Office document too large to preview');
        }
        return true;
      }
    });
  } catch (err) {
    if (err && err.code === 'OFFICE_PREVIEW_FAILED') throw err;
    throw mkOfficeError('Failed to read office document (corrupt or unsupported zip)', err);
  }

  let actualTotal = 0;
  for (const name of Object.keys(files)) {
    const size = files[name].length;
    if (size > MAX_ENTRY_INFLATED_BYTES) {
      throw mkOfficeError('Office document part too large to preview');
    }
    actualTotal += size;
    if (actualTotal > MAX_TOTAL_INFLATED_BYTES) {
      throw mkOfficeError('Office document too large to preview');
    }
  }
  return files;
}

/**
 * Read one zip entry as a UTF-8 string, or null if absent.
 * @param {Record<string, Uint8Array>} files - unzipSync() result
 * @param {string} name - Exact entry path (e.g. "xl/workbook.xml")
 * @returns {string|null}
 */
function readEntry(files, name) {
  const data = files[name];
  return data ? strFromU8(data) : null;
}

const NAMED_XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const XML_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g;

/**
 * Decode the small set of XML entities OOXML text runs use (named + numeric).
 * The inverse of escapeHtml — needed because the raw XML text is entity-
 * encoded and we want the literal characters before re-escaping for HTML
 * output (so the escaping is always ours, never a passthrough of whatever
 * the source XML happened to already contain).
 * @param {string} text - Raw XML text content
 * @returns {string} Decoded text
 */
function decodeXmlEntities(text) {
  return text.replace(XML_ENTITY_PATTERN, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint)) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return NAMED_XML_ENTITIES[entity] || match;
  });
}

/**
 * Extract the decoded text content of every `<...tagLocalName>...</...>`
 * element in `xml`, in document order, tolerant of an XML namespace prefix
 * (`<a:t>`, `<w:t>`, bare `<t>`) and of self-closing/empty elements (which
 * contribute nothing).
 * @param {string} xml - XML fragment to scan
 * @param {string} tagLocalName - Local (unprefixed) tag name, e.g. "t"
 * @returns {string[]} Decoded text of each matching element
 */
function extractTagTexts(xml, tagLocalName) {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tagLocalName}\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tagLocalName}>)`,
    'g'
  );
  const texts = [];
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    if (m[1] !== undefined) texts.push(decodeXmlEntities(m[1]));
  }
  return texts;
}

/**
 * Wrap a rendered fragment in the shared `.office-preview` shell + banner.
 * @param {string} inner - Already-escaped HTML fragment
 * @returns {string}
 */
function wrap(inner) {
  return `<div class="office-preview"><div class="office-preview-banner">${BANNER_TEXT}</div>${inner}</div>`;
}

/**
 * Build a single-notice `<div>` (or '' if nothing was truncated).
 * @param {string[]} notices - Notice strings (already plain text, not HTML)
 * @returns {string}
 */
function noticeHtml(notices) {
  if (notices.length === 0) return '';
  return `<div class="office-preview-notice">${notices.map(escapeHtml).join(' / ')}</div>`;
}

// ============================================================
// XLSX
// ============================================================

/**
 * Parse `xl/workbook.xml` into an ordered list of sheet names.
 * @param {string} xml - workbook.xml content
 * @returns {string[]}
 */
function parseSheetNames(xml) {
  const names = [];
  const pattern = /<(?:[\w.-]+:)?sheet\b([^>]*)\/?>/g;
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    const nameMatch = /\bname="([^"]*)"/.exec(m[1]);
    if (nameMatch) names.push(decodeXmlEntities(nameMatch[1]));
  }
  return names;
}

/**
 * Parse `xl/sharedStrings.xml` into an index-addressable array of decoded
 * strings (one per `<si>`, joining any `<t>` runs it contains).
 * @param {string|null} xml - sharedStrings.xml content, or null if absent
 * @returns {string[]}
 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const items = [];
  const pattern = /<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g;
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    items.push(extractTagTexts(m[1], 't').join(''));
  }
  return items;
}

// ============================================================
// XLSX number-format awareness (styles.xml → date/percent/thousands)
// ============================================================

// ECMA-376 built-in numFmtId → format code, for the ids this preview cares
// about (dates 14-22/45-47, percents 9-10, thousands-grouping 3-4/37-40).
// Builtin ids not listed here (0/General and anything unclassified) fall
// through to "no special formatting" — same as today's raw display.
const BUILTIN_FORMAT_CODES = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0;(#,##0)',
  38: '#,##0;(#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;(#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
};

// Builtin numFmtIds 27-36 are the CJK (Japanese/Korean/Chinese) date/time
// builtins. Their exact format text varies by Excel locale and isn't
// standardized the way 0-49 are, but the ids themselves are always
// date-ish — so they're classified directly rather than via a code lookup.
// 27-31/34-36 = CJK date builtins (era dates etc.). 32/33 are TIME
// (h"時"mm"分" / h"時"mm"分"ss"秒") and live in their own set below.
const BUILTIN_CJK_DATE_NUMFMT_IDS = new Set([27, 28, 29, 30, 31, 34, 35, 36]);
const BUILTIN_CJK_TIME_NUMFMT_IDS = new Map([[32, false], [33, true]]); // id -> hasSeconds

const NO_FORMAT = { isDate: false, hasTime: false, isPercent: false, isThousands: false };

/**
 * Strip quoted string literals (`"..."`) and bracketed sections (`[Red]`,
 * `[$-409]`, `[h]`, ...) from a number-format code before scanning it for
 * date/time/percent/grouping tokens — those sections can contain letters
 * (locale codes, literal text) that would otherwise be misread as format
 * tokens.
 * @param {string} code - Raw numFmt format code
 * @returns {string}
 */
function stripFormatLiterals(code) {
  return code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    // Backslash-escaped literal characters (e.g. `0\ days` renders " days"
    // verbatim) — the escaped d/y/h/s must not read as date/time tokens.
    .replace(/\\./g, '');
}

/**
 * Classify a number-format code as date-ish / time-only / time-bearing /
 * percent / thousands-grouped, scanning only outside quoted and bracketed
 * sections.
 * @param {string} code - Format code (e.g. "yyyy/m/d", "h:mm", "0.00%")
 * @returns {{ isDate: boolean, isTimeOnly: boolean, hasTime: boolean, isPercent: boolean, isThousands: boolean }}
 */
function classifyFormatCode(code) {
  // Elapsed-time bracket tokens ([h]/[mm]/[ss], builtin 46 "[h]:mm:ss",
  // custom "[h]:mm") must be recognized BEFORE bracket-stripping treats
  // them as literals — they mean "total elapsed", not clock-of-day, and
  // must neither wrap at 24h nor fall through to date/month classification.
  const elapsedMatch = /\[(h+|m+|s+)\]/i.exec(code);
  const isElapsed = elapsedMatch !== null;
  const elapsedUnit = elapsedMatch ? elapsedMatch[1][0].toLowerCase() : null;
  const stripped = stripFormatLiterals(code);
  // 'm' is ambiguous (month vs minute): only y/d prove a DATE part; h/s
  // prove a TIME part. A time-only format (builtin 18-21 "h:mm", durations
  // 45-47 "mm:ss") must NOT get a bogus 1899/12/31 date prefix — it is
  // classified isTimeOnly and rendered as clock time instead.
  const hasDatePart = !isElapsed && /[yd]/i.test(stripped);
  const hasTimePart = isElapsed || /[hs]/i.test(stripped);
  // Month-only codes (e.g. "mmm") with no time markers still read as dates.
  const monthOnly = !hasDatePart && !hasTimePart && /m/i.test(stripped);
  return {
    isDate: hasDatePart || monthOnly,
    isTimeOnly: hasTimePart && !hasDatePart && !monthOnly,
    isElapsed,
    elapsedUnit,
    hasTime: hasTimePart,
    // Seconds token (outside literals) or an elapsed [ss] bracket — the
    // time formatter must not silently drop seconds (90s is 00:01:30,
    // not "00:02").
    hasSeconds: /s/i.test(stripped) || /\[s+\]/i.test(code),
    isPercent: /%/.test(stripped),
    isThousands: /[#0],[#0]/.test(stripped),
  };
}

/**
 * Resolve a cell's numFmtId to its format classification.
 * @param {number} numFmtId - The `<xf numFmtId>` value for a cell's style
 * @param {Map<number,string>} customNumFmts - parseCustomNumFmts() result
 * @returns {{ isDate: boolean, hasTime: boolean, isPercent: boolean, isThousands: boolean }}
 */
function classifyByNumFmtId(numFmtId, customNumFmts) {
  if (BUILTIN_CJK_DATE_NUMFMT_IDS.has(numFmtId)) {
    return { isDate: true, hasTime: false, isPercent: false, isThousands: false };
  }
  if (BUILTIN_CJK_TIME_NUMFMT_IDS.has(numFmtId)) {
    return {
      isDate: false, isTimeOnly: true, isElapsed: false, elapsedUnit: null,
      hasTime: true, hasSeconds: BUILTIN_CJK_TIME_NUMFMT_IDS.get(numFmtId),
      isPercent: false, isThousands: false,
    };
  }
  const code = customNumFmts.get(numFmtId) ?? BUILTIN_FORMAT_CODES[numFmtId];
  return code === undefined ? NO_FORMAT : classifyFormatCode(code);
}

/**
 * Parse `<numFmts><numFmt numFmtId="..." formatCode="..."/>...</numFmts>`
 * (custom, workbook-defined formats) from styles.xml.
 * @param {string} xml - styles.xml content
 * @returns {Map<number,string>} numFmtId -> decoded format code
 */
function parseCustomNumFmts(xml) {
  const map = new Map();
  // Prefix-tolerant (<x:numFmt> is valid OOXML), like every other tag
  // reader in this file.
  const pattern = /<(?:[\w.-]+:)?numFmt\b([^>]*)\/?>/g;
  let m;
  while ((m = pattern.exec(xml)) !== null) {
    const attrs = m[1];
    const idMatch = /\bnumFmtId="(\d+)"/.exec(attrs);
    const codeMatch = /\bformatCode="([^"]*)"/.exec(attrs);
    if (idMatch && codeMatch) {
      map.set(parseInt(idMatch[1], 10), decodeXmlEntities(codeMatch[1]));
    }
  }
  return map;
}

/**
 * Parse `<cellXfs><xf numFmtId="..."/>...</cellXfs>` from styles.xml into an
 * ordered list of numFmtIds — array index == cell style index (the `s`
 * attribute on `<c>`).
 * @param {string} xml - styles.xml content
 * @returns {number[]}
 */
function parseCellXfsNumFmtIds(xml) {
  const section = /<(?:[\w.-]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/.exec(xml);
  if (!section) return [];
  const pattern = /<(?:[\w.-]+:)?xf\b([^>]*?)\/?>/g;
  const ids = [];
  let m;
  while ((m = pattern.exec(section[1])) !== null) {
    const idMatch = /\bnumFmtId="(\d+)"/.exec(m[1]);
    ids.push(idMatch ? parseInt(idMatch[1], 10) : 0);
  }
  return ids;
}

/**
 * Build the style-index -> format-classification lookup used by
 * {@link parseSheetRows}. Absent or unparseable styles.xml => `null`, which
 * signals "no styles = no conversion" (identical to pre-0.6.2 behavior).
 * @param {string|null} stylesXml - xl/styles.xml content, or null if absent
 * @returns {Array<{isDate:boolean,hasTime:boolean,isPercent:boolean,isThousands:boolean}>|null}
 */
function parseStyleFormats(stylesXml) {
  if (!stylesXml) return null;
  try {
    const customNumFmts = parseCustomNumFmts(stylesXml);
    const numFmtIds = parseCellXfsNumFmtIds(stylesXml);
    return numFmtIds.map((id) => classifyByNumFmtId(id, customNumFmts));
  } catch {
    return null;
  }
}

/**
 * Read the workbook's date system (1900 vs 1904) from
 * `<workbookPr date1904="1"/>` in xl/workbook.xml.
 * @param {string} workbookXml - workbook.xml content
 * @returns {boolean} true if the 1904 date system is in effect
 */
function isDate1904(workbookXml) {
  const m = /<(?:[\w.-]+:)?workbookPr\b([^>]*)\/?>/.exec(workbookXml);
  if (!m) return false;
  const dateMatch = /\bdate1904="([^"]*)"/.exec(m[1]);
  if (!dateMatch) return false;
  const v = dateMatch[1].trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Convert an Excel date serial number to `YYYY/M/D` (optionally with a
 * trailing `HH:MM` when the cell's format carries a time component and the
 * serial has a fractional part).
 *
 * Handles both the 1900 date system (with Excel's fictitious 1900-02-29 leap
 * day: serials > 59 are computed from the 1899-12-30 epoch, exactly
 * compensating for it) and the 1904 date system (serial 0 = 1904-01-01, no
 * leap-year quirk).
 * @param {number} serial - Raw numeric cell value
 * @param {boolean} hasTime - Whether the cell's format has time tokens
 * @param {boolean} date1904 - Whether the workbook uses the 1904 date system
 * @returns {string}
 */
function formatExcelDate(serial, hasTime, date1904, hasSeconds) {
  const pad = (n) => String(n).padStart(2, '0');
  let wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;

  // Round the time part to display precision FIRST and carry a full day
  // into the date — otherwise 44197.9999999 renders as the PREVIOUS day
  // at 00:00 instead of the next day (near-midnight timestamps).
  let timeStr = '';
  if (hasTime && fraction > 1e-6) {
    const unit = hasSeconds ? 86400 : 1440;
    let ticks = Math.round(fraction * unit);
    if (ticks >= unit) {
      wholeDays += 1;
      ticks = 0;
    }
    if (hasSeconds) {
      timeStr = ` ${pad(Math.floor(ticks / 3600))}:${pad(Math.floor((ticks % 3600) / 60))}:${pad(ticks % 60)}`;
    } else {
      timeStr = ` ${pad(Math.floor(ticks / 60))}:${pad(ticks % 60)}`;
    }
  }

  // Excel's 1900 system displays serial 60 as the nonexistent 1900/2/29
  // (Lotus 1-2-3 compatibility). Match the workbook's own display.
  if (!date1904 && wholeDays === 60) {
    return `1900/2/29${timeStr}`;
  }

  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : (wholeDays > 59 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31));
  const d = new Date(epoch + wholeDays * 86400000);

  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}${timeStr}`;
}

/**
 * Format a fractional value as a percent string, e.g. 0.62 -> "62%",
 * 0.625 -> "62.5%" (up to 2 decimals, trailing zeros trimmed).
 * @param {number} num - Raw cell value (the fraction, not already *100)
 * @returns {string}
 */
function formatPercent(num) {
  const str = (num * 100).toFixed(2).replace(/\.?0+$/, '');
  return `${str}%`;
}

/**
 * Format a number with thousands grouping, e.g. 1485000 -> "1,485,000".
 * No currency symbol is ever added, regardless of the source format code.
 * @param {number} num - Raw cell value
 * @returns {string}
 */
function formatThousands(num) {
  // maximumFractionDigits: toLocaleString's default of 3 would silently
  // round 1234.123456 to "1,234.123" — a data-accuracy bug, not styling.
  return num.toLocaleString('en-US', { maximumFractionDigits: 20 });
}

/**
 * Apply a cell's format classification (if any) to its raw numeric text.
 * Returns the raw text unchanged when there's no format info at all (no
 * styles.xml), the value isn't a finite number, or the format isn't
 * date/percent/thousands-classified.
 * @param {string} raw - Decoded raw `<v>` text
 * @param {{isDate:boolean,hasTime:boolean,isPercent:boolean,isThousands:boolean}|null} fmt
 * @param {boolean} date1904
 * @returns {string}
 */
function formatNumericCell(raw, fmt, date1904) {
  if (!fmt || raw === '' || raw.trim() === '') return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  if (fmt.isTimeOnly) {
    return fmt.isElapsed
      ? formatElapsed(num, fmt.elapsedUnit, fmt.hasSeconds)
      : formatExcelTime(num, false, fmt.hasSeconds);
  }
  if (fmt.isDate) return formatExcelDate(num, fmt.hasTime, date1904, fmt.hasSeconds);
  if (fmt.isPercent) return formatPercent(num);
  if (fmt.isThousands) return formatThousands(num);
  return raw;
}

/**
 * Format an Excel serial as time — used for time-only formats where a
 * calendar date would be meaningless (serial 0.5 = 12:00, not
 * "1899/12/31 12:00").
 * @param {number} serial - Excel serial value
 * @param {boolean} [isElapsed] - Elapsed-time format ([h]:mm etc.): render
 *   TOTAL hours without wrapping at 24 (1.5 days -> 36:00)
 * @returns {string}
 */
function formatExcelTime(serial, _isElapsed, hasSeconds) {
  const pad = (n) => String(n).padStart(2, '0');
  const fraction = serial - Math.floor(serial);
  if (hasSeconds) {
    const totalSeconds = Math.round(fraction * 86400);
    const hh = Math.floor(totalSeconds / 3600) % 24;
    const mm = Math.floor((totalSeconds % 3600) / 60);
    return `${pad(hh)}:${pad(mm)}:${pad(totalSeconds % 60)}`;
  }
  const totalMinutes = Math.round(fraction * 1440);
  const hh = Math.floor(totalMinutes / 60) % 24;
  return `${pad(hh)}:${pad(totalMinutes % 60)}`;
}

/**
 * Format an elapsed-time value in the unit its bracket token declares:
 * [h]:mm -> total hours, [mm]:ss -> total minutes, [ss] -> total seconds
 * (1.5 days: 36:00 / 2160:00 / 129600 respectively — Excel semantics).
 * @param {number} serial - Excel serial value (days)
 * @param {string|null} unit - 'h' | 'm' | 's' from the bracket token
 * @param {boolean} hasSeconds - Whether the format carries a seconds part
 * @returns {string}
 */
function formatElapsed(serial, unit, hasSeconds) {
  const pad = (n) => String(n).padStart(2, '0');
  const totalSeconds = Math.round(serial * 86400);
  if (unit === 's') return String(totalSeconds);
  if (unit === 'm') {
    const mm = Math.floor(totalSeconds / 60);
    return hasSeconds ? `${mm}:${pad(totalSeconds % 60)}` : String(mm);
  }
  const hh = Math.floor(totalSeconds / 3600);
  if (hasSeconds) {
    return `${hh}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
  }
  const totalMinutes = Math.round(serial * 1440);
  return `${Math.floor(totalMinutes / 60)}:${pad(totalMinutes % 60)}`;
}

/**
 * Convert a column-letter reference (A, B, ..., Z, AA, ...) to a zero-based
 * column index.
 * @param {string} letters - Uppercase column letters
 * @returns {number}
 */
function colLettersToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/**
 * Parse a cell reference like "B7" into { col, row } (col zero-based).
 * @param {string} ref - Cell reference
 * @returns {{ col: number, row: number }|null}
 */
function parseCellRef(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  return { col: colLettersToIndex(m[1].toUpperCase()), row: parseInt(m[2], 10) };
}

/**
 * Parse `xl/worksheets/sheetN.xml` rows/cells, keeping only the first
 * `maxRows` rows (columns are trimmed later once the true max column is
 * known). Shared strings, inline strings, and numeric/plain `<v>` values are
 * all supported, plus number-format-aware date/percent/thousands display
 * and formula-cell text when `styleFormats` is provided.
 * @param {string} xml - sheet XML content
 * @param {string[]} sharedStrings - parseSharedStrings() result
 * @param {{ maxRows: number, styleFormats?: Array|null, date1904?: boolean }} opts
 * @returns {{ rows: Array<Array<{col:number, text:string, formula?:boolean}>>, totalRows: number, maxColSeen: number }}
 */
function parseSheetRows(xml, sharedStrings, { maxRows, styleFormats = null, date1904 = false }) {
  const rowPattern = /<(?:[\w.-]+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g;
  const cellPattern = /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g;
  const rows = [];
  let totalRows = 0;
  let maxColSeen = -1;
  let overflowHasContent = false;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    totalRows++;
    if (rows.length >= maxRows) {
      // Beyond the preview window: only note whether anything DISPLAYABLE
      // exists out there. A tail of blank/style-only row elements is not a
      // real truncation — treating it as one would both suppress the
      // trailing-empty trim and show a misleading notice.
      if (!overflowHasContent && rowMatch[1]) {
        // v/t text only: real Excel always caches formula results, so a
        // cached-blank formula tail (<f>..</f><v/>) must not read as
        // content. Trade-off: openpyxl-style uncomputed formulas past the
        // window lose the notice — rarer and more harmless than a false
        // truncation banner on every formula-filled blank tail.
        overflowHasContent =
          /<(?:[\w.-]+:)?v\b[^>]*>[^<]/.test(rowMatch[1]) ||
          /<(?:[\w.-]+:)?t\b[^>]*>[^<]/.test(rowMatch[1]);
      }
      continue;
    }

    const inner = rowMatch[1];
    const cells = [];
    if (inner) {
      cellPattern.lastIndex = 0;
      let cellMatch;
      while ((cellMatch = cellPattern.exec(inner)) !== null) {
        const attrs = cellMatch[1];
        const content = cellMatch[2];
        const refMatch = /\br="([^"]+)"/.exec(attrs);
        const parsedRef = refMatch ? parseCellRef(refMatch[1]) : null;
        const col = parsedRef ? parsedRef.col : cells.length;
        if (col > maxColSeen) maxColSeen = col;

        if (content === undefined) continue; // self-closing => empty cell

        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const type = typeMatch ? typeMatch[1] : null;
        let text;
        let formula = false;

        // Formula with no cached <v> — checked BEFORE type-specific
        // handling: string-typed formula cells (t="str", common in
        // generated workbooks) would otherwise return '' and the formula
        // fallback below would never run.
        const fMatchEarly = /<(?:[\w.-]+:)?f\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?f>/.exec(content);
        const vMatchEarly = /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(content);
        // Formula cells with an empty/missing cached value need real-world
        // disambiguation (visual inspection of actual files, 2026-07-05):
        //  - Excel caches an empty-STRING result (="", IF(..,"",..)) as
        //    t="str" with an empty <v/> -> display BLANK, like Excel does.
        //  - openpyxl writes never-computed formulas as <f>..</f><v></v>
        //    with NO t attribute -> the whole value column would vanish;
        //    display the formula text instead.
        //  - t="str" with NO <v> at all is still never-computed -> formula.
        const vMissing = !vMatchEarly;
        const vEmpty = vMatchEarly && (vMatchEarly[1] ?? '').trim() === '';
        if (fMatchEarly && (vMissing || (vEmpty && type !== 'str'))) {
          formula = true;
          text = `=${decodeXmlEntities(fMatchEarly[1].trim())}`;
        } else if (type === 's') {
          const vMatch = /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(content);
          const idx = vMatch ? parseInt(vMatch[1] ?? '', 10) : NaN;
          text = Number.isInteger(idx) ? (sharedStrings[idx] || '') : '';
        } else if (type === 'inlineStr') {
          const isMatch = /<(?:[\w.-]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?is>/.exec(content);
          text = isMatch ? extractTagTexts(isMatch[1], 't').join('') : '';
        } else if (type === 'str' || type === 'b' || type === 'e') {
          // Formula-result string / boolean / error cells: unchanged
          // (raw decode, no number-format conversion — not in scope).
          const vMatch = /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(content);
          text = vMatch ? decodeXmlEntities(vMatch[1] ?? '') : '';
        } else {
          // No type attribute (or "n"): plain numeric value, or a formula
          // cell with a cached <v> (the no-cached-value case was handled
          // by the early formula fallback above).
          if (vMatchEarly) {
            // Cached numeric values go through the same number-format path
            // whether or not they came from a formula — a real Excel
            // =TODAY() cell with a date style must render like its plain
            // neighbors, not as a raw serial.
            const raw = decodeXmlEntities(vMatchEarly[1] ?? '');
            const sMatch = /\bs="(\d+)"/.exec(attrs);
            const styleIdx = sMatch ? parseInt(sMatch[1], 10) : 0;
            const fmt = styleFormats ? (styleFormats[styleIdx] || NO_FORMAT) : null;
            text = formatNumericCell(raw, fmt, date1904);
          } else {
            text = '';
          }
        }

        cells.push({ col, text, formula });
      }
    }
    rows.push(cells);
  }

  return { rows, totalRows, maxColSeen, overflowHasContent };
}

/**
 * Whether every cell in a row has empty (or whitespace-only) text.
 * @param {Array<{col:number, text:string}>} cells
 * @returns {boolean}
 */
function isRowEmpty(cells) {
  return cells.every((c) => !c.text || c.text.trim() === '');
}

/**
 * Drop trailing all-empty rows (rows at the very end of the sheet with no
 * cell text). Mid-table empty rows are preserved — only a contiguous run of
 * emptiness reaching the last row is removed, so table structure elsewhere
 * is unaffected.
 * @param {Array<Array<{col:number, text:string}>>} rows
 * @returns {Array<Array<{col:number, text:string}>>}
 */
function trimTrailingEmptyRows(rows) {
  let end = rows.length;
  while (end > 0 && isRowEmpty(rows[end - 1])) end--;
  return rows.slice(0, end);
}

/**
 * Render parsed rows into an HTML table, treating the first row as a
 * (sticky, styled via CSS) header.
 * @param {Array<Array<{col:number, text:string}>>} rows - parseSheetRows() rows
 * @param {number} colCount - Number of columns to render
 * @returns {string}
 */
function buildTableHtml(rows, colCount) {
  const renderCells = (cells, cellTag) => {
    const byCol = new Map(cells.map((c) => [c.col, c]));
    let out = '';
    for (let c = 0; c < colCount; c++) {
      const cell = byCol.get(c);
      const text = cell ? cell.text : '';
      const escaped = escapeHtml(text || '');
      out += cell && cell.formula
        ? `<${cellTag}><span class="office-preview-formula">${escaped}</span></${cellTag}>`
        : `<${cellTag}>${escaped}</${cellTag}>`;
    }
    return out;
  };

  const [headRow, ...bodyRows] = rows;
  const thead = `<thead><tr>${renderCells(headRow || [], 'th')}</tr></thead>`;
  const tbody = `<tbody>${bodyRows.map((r) => `<tr>${renderCells(r, 'td')}</tr>`).join('')}</tbody>`;

  return `<div class="office-preview-table-wrap"><table class="office-preview-table">${thead}${tbody}</table></div>`;
}

/**
 * List sheets other than the one being previewed (the first sheet), as
 * 「他のシート: ...」, or '' when there is only one sheet.
 * @param {string[]} sheetNames
 * @returns {string}
 */
function otherSheetsHtml(sheetNames) {
  const others = sheetNames.slice(1);
  if (others.length === 0) return '';
  return `<div class="office-preview-meta">他のシート: ${escapeHtml(others.join(', '))}</div>`;
}

/**
 * Locate the zip entry of the workbook's FIRST sheet (document order in
 * xl/workbook.xml). The part name is NOT always `sheet1.xml` — after
 * deleting/reordering sheets, Excel keeps whatever file the first sheet's
 * r:id relationship points at — so follow the relationship through
 * xl/_rels/workbook.xml.rels. Falls back to the conventional
 * `xl/worksheets/sheet1.xml` when the rels chain can't be resolved.
 * @param {Object} files - Unzipped entry map
 * @param {string} workbookXml
 * @returns {string|null} XML of the first sheet, or null
 */
function readFirstSheetXml(files, workbookXml) {
  const sheetTag = /<(?:\w+:)?sheet\b[^>]*>/.exec(workbookXml);
  const ridMatch = sheetTag && /\b(?:\w+:)?id="([^"]+)"/.exec(sheetTag[0]);
  const relsXml = readEntry(files, 'xl/_rels/workbook.xml.rels');

  if (ridMatch && relsXml) {
    const rid = ridMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const relTag = new RegExp(`<(?:\\w+:)?Relationship\\b[^>]*\\bId="${rid}"[^>]*>`).exec(relsXml);
    const target = relTag && /\bTarget="([^"]+)"/.exec(relTag[0]);
    if (target) {
      // Targets are relative to xl/ (e.g. "worksheets/sheet3.xml") or
      // package-absolute ("/xl/worksheets/sheet3.xml").
      const entryName = target[1].startsWith('/')
        ? target[1].slice(1)
        : `xl/${target[1]}`;
      const xml = readEntry(files, entryName);
      if (xml) return xml;
    }
  }
  return readEntry(files, 'xl/worksheets/sheet1.xml');
}

/**
 * Render a quick "vibe" preview of an .xlsx workbook's first sheet.
 * @param {Buffer|Uint8Array} buffer - Raw .xlsx bytes
 * @param {{ maxRows?: number, maxCols?: number }} [opts]
 * @returns {{ html: string, kind: 'xlsx' }}
 */
export function renderXlsxPreview(buffer, { maxRows = 50, maxCols = 20 } = {}) {
  const files = unzip(buffer);

  const workbookXml = readEntry(files, 'xl/workbook.xml');
  if (!workbookXml) throw mkOfficeError('Missing xl/workbook.xml');
  const sheetNames = parseSheetNames(workbookXml);
  const date1904 = isDate1904(workbookXml);

  const sheetXml = readFirstSheetXml(files, workbookXml);
  if (!sheetXml) throw mkOfficeError('Missing first worksheet part');

  const sharedStrings = parseSharedStrings(readEntry(files, 'xl/sharedStrings.xml'));
  const styleFormats = parseStyleFormats(readEntry(files, 'xl/styles.xml'));
  const { rows: parsedRows, totalRows, overflowHasContent } = parseSheetRows(sheetXml, sharedStrings, {
    maxRows,
    styleFormats,
    date1904,
  });

  // Whether maxRows actually truncated the sheet — computed before trailing
  // all-empty rows are trimmed, so trimming never triggers a false
  // "too many rows" notice. When the sheet IS truncated, blank rows at the
  // cut boundary are not true trailing rows (real rows follow them in the
  // workbook), so the trim is skipped to keep the advertised first-maxRows
  // window intact.
  const wasRowTruncated = totalRows > parsedRows.length && overflowHasContent;
  const rows = wasRowTruncated ? parsedRows : trimTrailingEmptyRows(parsedRows);

  // Column extent from the rows we actually RENDER: trimmed trailing rows
  // (or style-only far-right cells living solely in them) must not leave
  // ghost blank columns or a false column-truncation notice behind.
  const effectiveMaxCol = rows.reduce(
    (max, cells) => cells.reduce((m, cell) => Math.max(m, cell.col), max),
    -1
  );

  const colCount = effectiveMaxCol < 0 ? 0 : Math.min(effectiveMaxCol + 1, maxCols);
  const table = colCount === 0
    ? '<p class="office-preview-empty">(空のシートです)</p>'
    : buildTableHtml(rows, colCount);

  const notices = [];
  if (wasRowTruncated) {
    notices.push(`行数が多いため最初の${maxRows}行のみ表示しています（全${totalRows}行）`);
  }
  if (effectiveMaxCol + 1 > colCount) {
    notices.push(`列数が多いため最初の${maxCols}列のみ表示しています`);
  }

  const inner = otherSheetsHtml(sheetNames) + table + noticeHtml(notices);
  return { html: wrap(inner), kind: 'xlsx' };
}

// ============================================================
// PPTX
// ============================================================

/**
 * Render a quick "vibe" preview of a .pptx deck as a text outline: one card
 * per slide, first text run as the title, remaining runs as bullets.
 * @param {Buffer|Uint8Array} buffer - Raw .pptx bytes
 * @param {{ maxSlides?: number }} [opts]
 * @returns {{ html: string, kind: 'pptx' }}
 */
export function renderPptxPreview(buffer, { maxSlides = 30 } = {}) {
  const files = unzip(buffer);

  const slideEntries = Object.keys(files)
    .map((name) => {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
      return m ? { name, num: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  if (slideEntries.length === 0) throw mkOfficeError('No slides found in pptx');

  const totalSlides = slideEntries.length;
  const shown = slideEntries.slice(0, maxSlides);

  const slidesHtml = shown.map((entry, i) => {
    const xml = strFromU8(files[entry.name]);
    const runs = extractTagTexts(xml, 't');
    const title = runs[0] || '';
    const bullets = runs.slice(1);
    const bulletsHtml = bullets.length
      ? `<ul class="office-preview-slide-bullets">${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
      : '';

    return `<div class="office-preview-slide">` +
      `<div class="office-preview-slide-num">Slide ${i + 1}</div>` +
      `<div class="office-preview-slide-title">${escapeHtml(title)}</div>` +
      bulletsHtml +
      `</div>`;
  });

  const notices = totalSlides > shown.length
    ? [`スライドが多いため最初の${maxSlides}枚のみ表示しています（全${totalSlides}枚）`]
    : [];

  const inner = `<div class="office-preview-slides">${slidesHtml.join('')}</div>${noticeHtml(notices)}`;
  return { html: wrap(inner), kind: 'pptx' };
}

// ============================================================
// DOCX
// ============================================================

/**
 * Render a quick "vibe" preview of a .docx document as a sequence of plain
 * paragraphs.
 * @param {Buffer|Uint8Array} buffer - Raw .docx bytes
 * @param {{ maxParagraphs?: number }} [opts]
 * @returns {{ html: string, kind: 'docx' }}
 */
export function renderDocxPreview(buffer, { maxParagraphs = 200 } = {}) {
  const files = unzip(buffer);

  const xml = readEntry(files, 'word/document.xml');
  if (!xml) throw mkOfficeError('Missing word/document.xml');

  const paraPattern = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g;
  const paragraphs = [];
  let m;
  while ((m = paraPattern.exec(xml)) !== null) {
    paragraphs.push(m[1] ? extractTagTexts(m[1], 't').join('') : '');
  }

  const totalParagraphs = paragraphs.length;
  const shown = paragraphs.slice(0, maxParagraphs);

  const body = shown.length
    ? shown.map((p) => (p.trim() ? `<p>${escapeHtml(p)}</p>` : '<p>&nbsp;</p>')).join('')
    : '<p class="office-preview-empty">(内容がありません)</p>';

  const notices = totalParagraphs > shown.length
    ? [`段落が多いため最初の${maxParagraphs}段落のみ表示しています（全${totalParagraphs}段落）`]
    : [];

  const inner = `<div class="office-preview-docx">${body}</div>${noticeHtml(notices)}`;
  return { html: wrap(inner), kind: 'docx' };
}

export default { renderXlsxPreview, renderPptxPreview, renderDocxPreview };
