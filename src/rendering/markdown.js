/**
 * Markdown rendering using markdown-it
 */

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

// Initialize markdown-it with options
const md = new MarkdownIt({
  html: true,
  typographer: true,
  breaks: true,
  linkify: true
});

// Enable tables and strikethrough
md.enable('table');
md.enable('strikethrough');

// Enable task lists (checkboxes)
md.use(taskLists, { enabled: true, label: true, labelAfter: true });

// Pattern to detect Marp frontmatter (must be at very start of file, not using 'm' flag)
const MARP_PATTERN = /^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/;

// Pattern to detect YAML frontmatter at start of file
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/;

// Pattern to detect metadata block after h1 heading (Claude Agent format)
const HEADING_METADATA_PATTERN = /^(#[^\n]+\n+)(---\s*\n)([\s\S]*?)(\n---\s*)(\n|$)/;

// Pattern for Mermaid code blocks
const MERMAID_PATTERN = /```mermaid\s*\n([\s\S]*?)\n```/g;

/**
 * Check if content is a Marp presentation
 * @param {string} content - Markdown content
 * @returns {boolean}
 */
export function isMarp(content) {
  return MARP_PATTERN.test(content);
}

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
    const rest = content.slice(match[0].length);
    return `\`\`\`yaml\n${frontmatter}\n\`\`\`\n${rest}`;
  }

  // Check for metadata block after h1 heading (Claude Agent format)
  const headingMatch = content.match(HEADING_METADATA_PATTERN);
  if (headingMatch) {
    const heading = headingMatch[1];
    const metadata = headingMatch[3];
    const rest = content.slice(headingMatch[0].length);
    return `${heading}\`\`\`yaml\n${metadata}\n\`\`\`\n${rest}`;
  }

  return content;
}

/**
 * Protect Mermaid blocks from markdown processing
 * @param {string} content - Markdown content
 * @returns {{ content: string, blocks: string[] }}
 */
function protectMermaidBlocks(content) {
  const blocks = [];
  const protectedContent = content.replace(MERMAID_PATTERN, (match, code) => {
    blocks.push(code);
    return `<!--MERMAID_PLACEHOLDER_${blocks.length - 1}-->`;
  });
  return { content: protectedContent, blocks };
}

/**
 * Escape HTML entities for safe display
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeHtmlEntities(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Restore Mermaid blocks after markdown processing
 * @param {string} html - Rendered HTML
 * @param {string[]} blocks - Mermaid code blocks
 * @returns {string}
 */
function restoreMermaidBlocks(html, blocks) {
  let result = html;
  for (let i = 0; i < blocks.length; i++) {
    const escaped = escapeHtmlEntities(blocks[i]);
    const mermaidHtml = `<pre><code class="language-mermaid">${escaped}</code></pre>`;
    // Replace both paragraph-wrapped and bare placeholders
    result = result
      .replace(`<p><!--MERMAID_PLACEHOLDER_${i}--></p>`, mermaidHtml)
      .replace(`<!--MERMAID_PLACEHOLDER_${i}-->`, mermaidHtml);
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
  const { content: protectedContent, blocks } = protectMermaidBlocks(withFrontmatter);
  const html = md.render(protectedContent);
  return restoreMermaidBlocks(html, blocks);
}

export default { renderMarkdown, isMarp };
