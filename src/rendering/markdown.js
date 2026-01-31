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

// Pattern to detect YAML frontmatter
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/;

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
  const match = content.match(FRONTMATTER_PATTERN);
  if (match) {
    const frontmatter = match[1];
    const rest = content.slice(match[0].length);
    return `\`\`\`yaml\n${frontmatter}\n\`\`\`\n${rest}`;
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
  const protected_ = content.replace(MERMAID_PATTERN, (match, code) => {
    blocks.push(code);
    return `<!--MERMAID_PLACEHOLDER_${blocks.length - 1}-->`;
  });
  return { content: protected_, blocks };
}

/**
 * Restore Mermaid blocks after markdown processing
 * @param {string} html - Rendered HTML
 * @param {string[]} blocks - Mermaid code blocks
 * @returns {string}
 */
function restoreMermaidBlocks(html, blocks) {
  blocks.forEach((code, i) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const mermaidHtml = `<pre><code class="language-mermaid">${escaped}</code></pre>`;

    // Replace both paragraph-wrapped and bare placeholders
    html = html.replace(`<p><!--MERMAID_PLACEHOLDER_${i}--></p>`, mermaidHtml);
    html = html.replace(`<!--MERMAID_PLACEHOLDER_${i}-->`, mermaidHtml);
  });
  return html;
}

/**
 * Add line numbers to rendered elements for editor sync
 * @param {string} html - Rendered HTML
 * @returns {string}
 */
function addLineNumbers(html) {
  // This is a simplified version - the full implementation would
  // track source positions during rendering
  return html;
}

/**
 * Render markdown to HTML
 * @param {string} content - Markdown content
 * @returns {string} HTML
 */
export function renderMarkdown(content) {
  // Convert frontmatter to code block
  content = convertFrontmatter(content);

  // Protect Mermaid blocks
  const { content: protected_, blocks } = protectMermaidBlocks(content);

  // Render markdown
  let html = md.render(protected_);

  // Restore Mermaid blocks
  html = restoreMermaidBlocks(html, blocks);

  // Add line numbers
  html = addLineNumbers(html);

  return html;
}

export default { renderMarkdown, isMarp };
