/**
 * Single source of truth for HTML entity escaping.
 *
 * Replaces 3 drifted server-side implementations that the audit flagged:
 *  - `src/rendering/index.js` (local `escapeHtml`, 5-entity)
 *  - `src/rendering/markdown.js` (`escapeHtmlEntities`, 3-entity — missing
 *    `"` and `'`, so Mermaid code blocks were escaped less strictly than
 *    everything else)
 *  - `src/api/file.js` (inline `.replace()` chain for HTML file previews)
 *
 * This module only introduces the canonical implementation; it does not
 * rewire those three call sites (owned by other agents in this refactor).
 */

const ENTITY_MAP = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;'
});

const ENTITY_PATTERN = /[&<>"']/g;

/**
 * Escape the 5 canonical HTML-unsafe characters (`& < > " '`) for safe
 * display inside HTML markup.
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  return text.replace(ENTITY_PATTERN, (char) => ENTITY_MAP[char]);
}

export default escapeHtml;
