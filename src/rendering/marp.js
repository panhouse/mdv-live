/**
 * Marp rendering — thin compat layer over `marpitAdapter.renderDeck`.
 *
 * Historically this file owned its own Marp instance. The audit flagged
 * that as a SOLID/DRY violation: the adapter already owns the canonical
 * instance, and having two of them risked subtle directive-state drift
 * between code paths. We now delegate to the adapter.
 *
 * IMPORTANT: Do not modify Marp's HTML output structure.
 * The CSS depends on the exact structure: div.marpit > svg > foreignObject > section
 */

import { renderDeck } from './marpitAdapter.js';

/**
 * Render Marp presentation to HTML.
 * @param {string} content - Markdown content with Marp frontmatter
 * @returns {{ html: string, css: string, slideCount: number, notes: string[], notesMultiplicity: number[] }}
 */
export function renderMarp(content) {
  return renderDeck(content);
}

/**
 * Get available Marp themes.
 */
export function getThemes() {
  return ['default', 'gaia', 'uncover'];
}

export default { renderMarp, getThemes };
