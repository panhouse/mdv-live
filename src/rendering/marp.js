/**
 * Marp rendering using @marp-team/marp-core
 *
 * IMPORTANT: Do not modify Marp's HTML output structure.
 * The CSS depends on the exact structure: div.marpit > svg > foreignObject > section
 */

import { Marp } from '@marp-team/marp-core';

// Initialize Marp with full HTML support
const marp = new Marp({
  html: true,
  math: true,
  markdown: {
    html: true,
    breaks: false,
    linkify: true,
  }
});

// Disable indented code blocks (4-space indent → code)
// This allows HTML with indentation to render properly
marp.markdown.disable('code');

/**
 * Render Marp presentation to HTML
 * @param {string} content - Markdown content with Marp frontmatter
 * @returns {{ html: string, css: string, slideCount: number, notes: string[] }}
 */
export function renderMarp(content) {
  const { html, css, comments } = marp.render(content);

  // Count slides by counting <section> tags
  const slideCount = (html.match(/<section[^>]*>/g) || []).length;

  // Flatten per-slide comments into a single notes string per slide.
  // marp-core returns `comments` as a 2D array (one inner array per slide).
  const notes = (comments || []).map((slideComments) =>
    Array.isArray(slideComments) ? slideComments.join('\n\n').trim() : ''
  );
  while (notes.length < slideCount) notes.push('');

  // Return Marp's HTML output AS-IS to preserve CSS selector compatibility
  return {
    html,
    css,
    slideCount,
    notes
  };
}

/**
 * Get available Marp themes
 * @returns {string[]} Theme names
 */
export function getThemes() {
  return ['default', 'gaia', 'uncover'];
}

export default { renderMarp, getThemes };
