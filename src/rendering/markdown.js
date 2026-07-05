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

/**
 * Convert YAML frontmatter to code block for display
 * @param {string} content - Markdown content
 * @returns {string} Content with frontmatter converted
 */
function convertFrontmatter(content) {
  // Check for standard frontmatter at start of file
  const match = content.match(FRONTMATTER_PATTERN);
  if (match) {
    const frontmatter = match[1];
    // Skip empty frontmatter (treat as horizontal rules instead)
    if (!frontmatter.trim()) {
      return content;
    }
    const rest = content.slice(match[0].length);
    return `\`\`\`yaml\n${frontmatter}\n\`\`\`\n${rest}`;
  }

  return content;
}

// Generate a per-render nonce to prevent placeholder collision with user content
const MERMAID_NONCE = Math.random().toString(36).slice(2, 10);

/**
 * Protect Mermaid blocks from markdown processing
 * @param {string} content - Markdown content
 * @returns {{ content: string, blocks: string[], nonce: string }}
 */
function protectMermaidBlocks(content) {
  const blocks = [];
  const nonce = MERMAID_NONCE + '_' + Date.now().toString(36);
  const protectedContent = content.replace(MERMAID_PATTERN, (match, code) => {
    blocks.push(code);
    return `<!--MDV_MERMAID_${nonce}_${blocks.length - 1}-->`;
  });
  return { content: protectedContent, blocks, nonce };
}

/**
 * Restore Mermaid blocks after markdown processing
 * @param {string} html - Rendered HTML
 * @param {string[]} blocks - Mermaid code blocks
 * @param {string} nonce - Nonce used during protection
 * @returns {string}
 */
function restoreMermaidBlocks(html, blocks, nonce) {
  let result = html;
  for (let i = 0; i < blocks.length; i++) {
    const escaped = escapeHtml(blocks[i]);
    const mermaidHtml = `<pre><code class="language-mermaid">${escaped}</code></pre>`;
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
  const withFrontmatter = convertFrontmatter(content);
  const { content: protectedContent, blocks, nonce } = protectMermaidBlocks(withFrontmatter);
  const html = md.render(protectedContent);
  return restoreMermaidBlocks(html, blocks, nonce);
}

export default { renderMarkdown, isMarp };
