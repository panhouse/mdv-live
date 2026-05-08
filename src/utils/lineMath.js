/**
 * 行↔バイト (JS string index) 変換ヘルパ。
 *
 * 規約:
 *  - BOM (U+FEFF) は rawSource[0] にそのまま残す。lineStarts[0] = 0。
 *  - 改行は LF / CRLF / CR の混在を検出。最頻種を `lineEnding` として記録し、
 *    新規挿入行のみその改行種別を使う。既存改行は触らない。
 *  - lineStarts[i] = i 行目（0-origin）の先頭の JS string index。
 *  - markdown-it / marpit の token.map と整合: countLines が `t.map[1]` の
 *    最大値と一致する。
 */

/** Compute the string index of the start of each line (0-origin). */
export function computeLineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') {
      starts.push(i + 1);
    } else if (ch === '\r') {
      // Treat \r and \r\n as a single line break.
      const next = i + 1;
      if (next < source.length && source[next] === '\n') {
        starts.push(next + 1);
        i++;
      } else {
        starts.push(next);
      }
    }
  }
  return starts;
}

/**
 * Inspect raw source for line-ending statistics, BOM, EOF newline.
 * @param {string} source
 * @returns {{
 *   lineEnding: '\n' | '\r\n' | '\r',
 *   hasBom: boolean,
 *   endsWithNewline: boolean,
 *   lineStarts: number[]
 * }}
 */
export function analyseSource(source) {
  const hasBom = source.charCodeAt(0) === 0xFEFF;
  const crlf = (source.match(/\r\n/g) || []).length;
  const lf = (source.match(/(?<!\r)\n/g) || []).length;
  const cr = (source.match(/\r(?!\n)/g) || []).length;
  let lineEnding = '\n';
  if (crlf > lf && crlf > cr) lineEnding = '\r\n';
  else if (cr > lf && cr > crlf) lineEnding = '\r';
  const endsWithNewline = /(?:\r\n|\r|\n)$/.test(source);
  const lineStarts = computeLineStarts(source);
  return { lineEnding, hasBom, endsWithNewline, lineStarts };
}

/**
 * Convert a line index to a string index. Throws if line is out of range.
 * @param {number[]} lineStarts
 * @param {number} line  0-origin line number
 * @returns {number}
 */
export function lineToOffset(lineStarts, line) {
  if (line < 0) throw new Error(`line out of range: ${line}`);
  if (line < lineStarts.length) return lineStarts[line];
  // For one-past-the-end (== total lines), return source length.
  // Caller (e.g. last slide endLine) should pass `source.length` separately.
  throw new Error(`line out of range: ${line} (max ${lineStarts.length - 1})`);
}

/**
 * Convert [startLine, endLine) half-open line range to [startOffset, endOffset).
 * `endLine` may equal `totalLines` to mean "to end of source".
 *
 * @param {number[]} lineStarts
 * @param {number} totalLines  number of lines in the source
 * @param {number} sourceLength
 * @param {number} startLine
 * @param {number} endLine
 * @returns {{startOffset: number, endOffset: number}}
 */
export function lineRangeToOffsets(lineStarts, totalLines, sourceLength, startLine, endLine) {
  const startOffset = lineToOffset(lineStarts, startLine);
  const endOffset = endLine >= totalLines ? sourceLength : lineToOffset(lineStarts, endLine);
  return { startOffset, endOffset };
}
