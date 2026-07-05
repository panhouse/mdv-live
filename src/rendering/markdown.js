/**
 * Markdown rendering using markdown-it
 */

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { escapeHtml } from '../utils/html.js';

/**
 * markdown-it plugin: CJK + Unicode句読点で emphasis が壊れる問題を修正。
 *
 * 根本原因: CommonMark の flanking delimiter 判定は、delimiter の隣が
 * Unicode句読点のとき、反対側も空白か句読点でないと flanking と認めない。
 *   right_flanking = !isLastWS && (!isLastPunct || isNextWS || isNextPunct)
 *   left_flanking  = !isNextWS && (!isNextPunct || isLastWS || isLastPunct)
 *
 * ラテン文字圏では妥当だが、CJK文字（漢字・ひらがな・カタカナ）は
 * 空白でも句読点でもないため、「）**を」のような配置で flanking 判定が
 * 不当に失敗する。
 *
 * 修正方針: flanking 判定の条件式に「反対側がCJKテキスト文字なら、
 * 句読点の隣接制限を免除する」条件を追加する。
 * CJKは語境界を空白で示さないため、句読点の隣にCJKがあっても
 * delimiter は flanking と見なすのが自然。
 *
 * isWhiteSpace / isPunct の分類は変えない。flanking 条件式だけを拡張する。
 */
function cjkEmphasisFix(md) {
  const StateInline = md.inline.State;
  const origScanDelims = StateInline.prototype.scanDelims;

  // CJKテキスト文字（句読点・記号は含めない）
  // Hiragana, Katakana, CJK Unified Ideographs, CJK Ext-A,
  // Hangul Syllables, CJK Compatibility Ideographs
  const CJK_TEXT_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

  StateInline.prototype.scanDelims = function (start, canSplitWord) {
    const result = origScanDelims.call(this, start, canSplitWord);

    // 元の判定で OK なら何もしない
    if (result.can_open && result.can_close) return result;

    // delimiter の前後の文字を取得
    const max = this.posMax;
    const marker = this.src.charCodeAt(start);
    let pos = start;
    while (pos < max && this.src.charCodeAt(pos) === marker) { pos++; }

    const lastChar = start > 0 ? this.src.charAt(start - 1) : '';
    const nextChar = pos < max ? this.src.charAt(pos) : '';

    const lastIsCJK = CJK_TEXT_RE.test(lastChar);
    const nextIsCJK = CJK_TEXT_RE.test(nextChar);

    // CJKテキスト文字が delimiter の反対側にあるなら、
    // 句読点隣接による flanking 拒否を解除する。
    //
    // can_close が false になるケース:
    //   lastChar=句読点, nextChar=CJK → right_flanking が false
    //   → nextIsCJK なら can_close = true に補正
    //
    // can_open が false になるケース:
    //   lastChar=CJK, nextChar=句読点 → left_flanking が false
    //   → lastIsCJK なら can_open = true に補正
    if (!result.can_close && nextIsCJK) {
      result.can_close = true;
    }
    if (!result.can_open && lastIsCJK) {
      result.can_open = true;
    }

    return result;
  };
}

// Initialize markdown-it with options
const md = new MarkdownIt({
  html: true,
  typographer: true,
  breaks: true,
  linkify: true
});

// Fix CJK emphasis issues before other plugins
md.use(cjkEmphasisFix);

// Enable tables and strikethrough
md.enable('table');
md.enable('strikethrough');

// Enable task lists (checkboxes)
md.use(taskLists);

// Pattern to detect YAML frontmatter at start of file
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/;

// Pattern for Mermaid code blocks
const MERMAID_PATTERN = /```mermaid\s*\n([\s\S]*?)\n```/g;

// Re-export the SSOT version of isMarp so callers don't import a separate
// (and previously slightly different) regex from this module.
import { isMarp } from './marpitAdapter.js';
export { isMarp };

// ---------------------------------------------------------------------------
// Source-line mapping
//
// renderMarkdown() runs the raw file content through two text-level
// transforms *before* handing it to markdown-it (convertFrontmatter,
// protectMermaidBlocks — see below). Both can change the document's line
// count (frontmatter's `---`/blank-line block collapses or expands into a
// ```yaml fence; a multi-line ```mermaid fence collapses into a single-line
// HTML-comment placeholder). token.map — which the core rule below reads —
// is computed against that *transformed* content, not the original raw
// file. Left uncorrected, every data-source-line after a frontmatter block
// or a mermaid diagram would point at the wrong raw-file line.
//
// buildReverseLineMapper() + the mapLine functions convertFrontmatter()/
// protectMermaidBlocks() now return fix this up: renderMarkdown() composes
// them into a single mapSourceLine(transformedLine) -> rawLine function and
// threads it through md.render()'s `env`, so the core rule always emits the
// *original raw file* line number.
// ---------------------------------------------------------------------------

/**
 * Number of display lines a string spans, given that it starts at the
 * beginning of a line (i.e. the count of line terminators inside it, plus
 * one — unless it ends exactly on a line terminator, in which case the
 * trailing empty fragment isn't a consumed line). Treats \r\n and lone \r
 * as a single break, matching markdown-it's own line-ending normalization.
 * @param {string} str
 * @returns {number}
 */
function lineSpanOf(str) {
  const breaks = str.match(/\r\n|\r|\n/g);
  const count = breaks ? breaks.length : 0;
  const endsOnBreak = /(?:\r\n|\r|\n)$/.test(str);
  return count - (endsOnBreak ? 1 : 0) + 1;
}

/**
 * 1-based line number containing character offset `offset` in `str`.
 * @param {string} str
 * @param {number} offset
 * @returns {number}
 */
function lineAtOffset(str, offset) {
  const breaks = str.slice(0, offset).match(/\r\n|\r|\n/g);
  return 1 + (breaks ? breaks.length : 0);
}

/**
 * Builds a reverse line-mapper from a list of substitutions, each describing
 * a contiguous [oldStart, oldStart+oldSpan) 1-based line range that was
 * replaced by a contiguous [newStart, newStart+newSpan) range (substitutions
 * must be sorted ascending by newStart, non-overlapping — true for both call
 * sites below, since each is a single left-to-right text pass). Returns a
 * function mapping a line number in the "new" text back to the "old" text.
 *
 * A line falling *inside* a substituted range maps to that range's
 * oldStart — a representative, not a per-line inverse. That's sufficient
 * here because each substituted range renders as at most one markdown-it
 * token (the frontmatter's synthetic ```yaml fence, or a Mermaid block's
 * single-line placeholder comment).
 * @param {Array<{oldStart:number, oldSpan:number, newStart:number, newSpan:number}>} substitutions
 * @returns {(line: number) => number}
 */
function buildReverseLineMapper(substitutions) {
  if (!substitutions.length) return (line) => line;
  return function toOldLine(line) {
    let delta = 0;
    for (const sub of substitutions) {
      if (line < sub.newStart) break;
      if (line < sub.newStart + sub.newSpan) return sub.oldStart;
      delta = (sub.oldStart + sub.oldSpan) - (sub.newStart + sub.newSpan);
    }
    return line + delta;
  };
}

// Block-level token types deliberately excluded from data-source-line: adding
// the attribute to any of these changes their opening tag from a bare `<ul>`/
// `<ol>`/`<blockquote>`/`<table>` to one with an attribute, which breaks
// pre-existing exact-string assertions in tests/test-markdown-rendering.js
// (e.g. `data.content.includes('<table>')`) that this change must not modify.
// Tables still get row-level coverage (thead_open/tbody_open/tr_open keep
// their map), and blockquotes still get their inner paragraph's line.
//
// `list_item_open` (<li>) is intentionally NOT in this set (0.6.6 — see
// tests/test-source-line-mapping.js's "List items" describe block for the
// contract this establishes). It used to be excluded for the same
// bare-opening-tag reason as its siblings, but that traded away the single
// most user-visible mapping gap: a tight list (the common case — no blank
// line between items, so the item's inner paragraph is `hidden` and carries
// no rendered tag of its own) left every bullet with NO data-source-line
// anywhere inside it, so a changed 議事録 decision bullet fell through to
// diffReview.js's/searchPalette.js's nearest-PRECEDING-block fallback and
// highlighted/jumped-to whatever heading or paragraph came before it
// instead of the bullet itself. `list_item_open` always carries its own
// `.map` — tight or loose, nested or not, task-list or not (the
// markdown-it-task-lists plugin's `class="task-list-item"` attrSet on this
// same token, in its own core rule registered earlier, composes fine with
// ours since each just appends its own attribute) — so tagging it directly
// costs nothing structurally and only touches the tests that asserted a
// bare `<li>` on purpose (updated deliberately alongside this change, not
// worked around). `<ul>`/`<ol>` themselves stay bare; only the `<li>`s
// inside them gain the attribute.
const SOURCE_LINE_EXCLUDED_TYPES = new Set([
  'bullet_list_open',
  'ordered_list_open',
  'blockquote_open',
  'table_open'
]);

/**
 * markdown-it core rule: for every block-level token with a non-null
 * `.map` (heading/paragraph/fence/code_block/hr/thead/tbody/tr/li/...),
 * sets `data-source-line` to the 1-based *original raw file* line the
 * block starts at (`env.mapSourceLine`, when provided, translates the
 * transformed-content line markdown-it saw back to the raw line — see
 * the "Source-line mapping" note above; falls back to identity so calling
 * `md.render()`/`md.parse()` without an env still works, e.g. in tests).
 * `inline` tokens are skipped (they carry a `.map` too, but aren't
 * rendered as a tag of their own — see markdown-it's renderer.render()).
 * @param {object} state - markdown-it core rule state
 */
function injectSourceLineRule(state) {
  const mapSourceLine = (state.env && typeof state.env.mapSourceLine === 'function')
    ? state.env.mapSourceLine
    : (line) => line;
  for (const token of state.tokens) {
    if (!token.map || token.type === 'inline' || SOURCE_LINE_EXCLUDED_TYPES.has(token.type)) continue;
    token.attrSet('data-source-line', String(mapSourceLine(token.map[0] + 1)));
  }
}

md.core.ruler.push('mdv_source_line', injectSourceLineRule);

/**
 * Convert YAML frontmatter to code block for display
 * @param {string} content - Markdown content
 * @returns {{ content: string, mapLine: (line: number) => number }} Content
 *   with frontmatter converted, plus a line-mapper back to `content`'s own
 *   line numbers (identity if nothing was converted).
 */
function convertFrontmatter(content) {
  const identity = { content, mapLine: (line) => line };
  // Check for standard frontmatter at start of file
  const match = content.match(FRONTMATTER_PATTERN);
  if (match) {
    const frontmatter = match[1];
    // Skip empty frontmatter (treat as horizontal rules instead)
    if (!frontmatter.trim()) {
      return identity;
    }
    const rest = content.slice(match[0].length);
    const header = `\`\`\`yaml\n${frontmatter}\n\`\`\`\n`;
    const mapLine = buildReverseLineMapper([{
      oldStart: 1,
      oldSpan: lineSpanOf(match[0]),
      newStart: 1,
      newSpan: lineSpanOf(header)
    }]);
    return { content: header + rest, mapLine };
  }

  return identity;
}

// Generate a per-render nonce to prevent placeholder collision with user content
const MERMAID_NONCE = Math.random().toString(36).slice(2, 10);

/**
 * Protect Mermaid blocks from markdown processing
 * @param {string} content - Markdown content
 * @returns {{ content: string, blocks: string[], nonce: string,
 *   mapLine: (line: number) => number, blockStartLines: number[] }}
 *   `mapLine` translates a line in the returned `content` back to a line in
 *   the input `content`. `blockStartLines[i]` is the input-`content` line
 *   where mermaid block `i`'s ` ```mermaid ` fence starts (for baking
 *   data-source-line into the restored `<pre>` in restoreMermaidBlocks,
 *   which never goes through markdown-it tokens at all).
 */
function protectMermaidBlocks(content) {
  const blocks = [];
  const substitutions = [];
  const nonce = MERMAID_NONCE + '_' + Date.now().toString(36);
  let shrink = 0;
  const protectedContent = content.replace(MERMAID_PATTERN, (match, code, offset) => {
    const oldStart = lineAtOffset(content, offset);
    const oldSpan = lineSpanOf(match);
    const newStart = oldStart - shrink;
    substitutions.push({ oldStart, oldSpan, newStart, newSpan: 1 });
    shrink += oldSpan - 1; // each block collapses to exactly one placeholder line
    blocks.push(code);
    return `<!--MDV_MERMAID_${nonce}_${blocks.length - 1}-->`;
  });
  return {
    content: protectedContent,
    blocks,
    nonce,
    mapLine: buildReverseLineMapper(substitutions),
    blockStartLines: substitutions.map((sub) => sub.oldStart)
  };
}

/**
 * Restore Mermaid blocks after markdown processing
 * @param {string} html - Rendered HTML
 * @param {string[]} blocks - Mermaid code blocks
 * @param {string} nonce - Nonce used during protection
 * @param {Array<number|undefined>} [sourceLines] - 1-based raw-file line
 *   for each block's ` ```mermaid ` fence (parallel to `blocks`), baked in
 *   as data-source-line. Omitted/undefined entries render without the
 *   attribute.
 * @returns {string}
 */
function restoreMermaidBlocks(html, blocks, nonce, sourceLines) {
  let result = html;
  for (let i = 0; i < blocks.length; i++) {
    const escaped = escapeHtml(blocks[i]);
    const line = sourceLines ? sourceLines[i] : undefined;
    const lineAttr = line != null ? ` data-source-line="${line}"` : '';
    const mermaidHtml = `<pre${lineAttr}><code class="language-mermaid">${escaped}</code></pre>`;
    const placeholder = `<!--MDV_MERMAID_${nonce}_${i}-->`;
    // Replace both paragraph-wrapped and bare placeholders (use split+join for global replace)
    result = result
      .split(`<p>${placeholder}</p>`).join(mermaidHtml)
      .split(placeholder).join(mermaidHtml);
  }
  return result;
}

/**
 * Render markdown to HTML
 * @param {string} content - Markdown content
 * @returns {string}
 */
export function renderMarkdown(content) {
  const { content: withFrontmatter, mapLine: unmapFrontmatterLine } = convertFrontmatter(content);
  const { content: protectedContent, blocks, nonce, mapLine: unmapMermaidLine, blockStartLines } =
    protectMermaidBlocks(withFrontmatter);
  const mapSourceLine = (line) => unmapFrontmatterLine(unmapMermaidLine(line));
  const html = md.render(protectedContent, { mapSourceLine });
  const mermaidSourceLines = blockStartLines.map(unmapFrontmatterLine);
  return restoreMermaidBlocks(html, blocks, nonce, mermaidSourceLines);
}

export default { renderMarkdown, isMarp };
