/**
 * MarpitTokenAdapter — Marp/Marpit のパーサ出力を正規化する 1 箇所のラッパ。
 *
 * Slide 範囲・speaker note 位置の特定はすべてこのモジュール経由で行う。
 * 直接 marp.markdown.parse() / marp.render() を別の場所から呼ばない。
 *
 * 契約 (tests/test-marpit-adapter.js で snapshot 凍結):
 *  - marpit_slide_open.map === [startLine, endLine]
 *  - marpit_comment.content は両側 trim 済み
 *  - marpit_comment.map === [startLine, endLineExclusive]
 *  - marpit_slide_close.map は null になり得る
 *  - BOM 付き入力で slide_open.map[0] === 0
 *  - render(rawSource).comments は 2D 配列で directive を除外済み
 */

import { Marp } from '@marp-team/marp-core';
import { mkError } from '../utils/errors.js';

const marp = new Marp({
  html: true,
  math: true,
  markdown: { html: true, breaks: false, linkify: true }
});
marp.markdown.disable('code');

/**
 * Marp deck を解析し、slide 範囲・classified notes・comment 位置を返す。
 *
 * @param {string} rawSource
 * @returns {{
 *   slideCount: number,
 *   slideRanges: Array<{startLine: number, endLine: number}>,
 *   classifiedNotes: string[][],
 *   commentsBySlide: Array<Array<{content: string, startLine: number, endLine: number}>>,
 *   notesMultiplicity: number[]
 * }}
 * @throws {Error} code='NOT_PARSEABLE' if Marpit returns malformed tokens.
 */
export function parseDeck(rawSource) {
  const env = {};
  const tokens = marp.markdown.parse(rawSource, env);
  const { comments: classifiedNotes } = marp.render(rawSource);

  const slideOpens = tokens.filter((t) => t.type === 'marpit_slide_open');
  for (const t of slideOpens) {
    if (!t.map) throw mkError('NOT_PARSEABLE', 'slide_open without source map');
  }
  const slideStartLines = slideOpens.map((t) => t.map[0]);
  const totalLines = countLines(rawSource);

  const slideRanges = slideStartLines.map((start, i) => ({
    startLine: start,
    endLine: i + 1 < slideStartLines.length ? slideStartLines[i + 1] : totalLines
  }));

  const commentsBySlide = slideRanges.map(() => []);
  let cursor = -1;
  for (const t of tokens) {
    if (t.type === 'marpit_slide_open') {
      cursor = slideStartLines.indexOf(t.map[0]);
      continue;
    }
    if (t.type === 'marpit_comment' && cursor >= 0) {
      if (!t.map) throw mkError('NOT_PARSEABLE', 'marpit_comment without source map');
      commentsBySlide[cursor].push({
        content: t.content,
        startLine: t.map[0],
        endLine: t.map[1]
      });
    }
  }

  const notesMultiplicity = classifiedNotes.map((arr) => (arr || []).length);

  return {
    slideCount: slideRanges.length,
    slideRanges,
    classifiedNotes,
    commentsBySlide,
    notesMultiplicity
  };
}

/**
 * commentsBySlide[i] のうち、classifiedNotes[i] と順序 zip でマッチしたもの
 * だけを speaker note として返す。directive コメントは classifiedNotes には
 * 出ないので、自然に除外される。
 *
 * @param {Array<{content: string, startLine: number, endLine: number}>} commentsInSlide
 * @param {string[]} noteStrings
 * @returns {Array<{content: string, startLine: number, endLine: number}>}
 * @throws {Error} code='NOT_PARSEABLE' if zip ends with mismatched count.
 */
export function pickNoteComments(commentsInSlide, noteStrings) {
  const notes = [];
  let cursor = 0;
  for (const c of commentsInSlide) {
    if (cursor < noteStrings.length && c.content === noteStrings[cursor]) {
      notes.push(c);
      cursor++;
    }
  }
  if (cursor !== noteStrings.length) {
    throw mkError('NOT_PARSEABLE', 'comment tokens do not match classifiedNotes');
  }
  return notes;
}

/**
 * markdown-it / marpit の行カウント慣例に整合する line 数を返す。
 * `t.map` の `endLine` と整合させるため、末尾改行ありなら改行数、なしなら +1。
 */
export function countLines(source) {
  if (source.length === 0) return 0;
  const newlines = (source.match(/\r\n|\r|\n/g) || []).length;
  const endsWithNewline = /(?:\r\n|\r|\n)$/.test(source);
  return endsWithNewline ? newlines : newlines + 1;
}

/**
 * Marp 互換 marker (`marp: true` を frontmatter に含むか)。
 */
export function isMarp(content) {
  return /^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/.test(content);
}

/**
 * Render の薄いラッパ（既存呼び出し元との互換用）。
 */
export function renderDeck(rawSource) {
  const { html, css, comments } = marp.render(rawSource);
  const slideCount = (html.match(/<section[^>]*>/g) || []).length;
  const notes = (comments || []).map((arr) =>
    Array.isArray(arr) ? arr.join('\n\n').trim() : ''
  );
  while (notes.length < slideCount) notes.push('');
  const notesMultiplicity = (comments || []).map((arr) => (arr || []).length);
  return { html, css, slideCount, notes, notesMultiplicity };
}
