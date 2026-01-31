/**
 * Rendering module - combines markdown-it and marp-core
 */

import fs from 'fs/promises';
import { getFileType } from '../utils/fileTypes.js';
import { renderMarkdown, isMarp } from './markdown.js';
import { renderMarp } from './marp.js';

/**
 * Escape HTML entities
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Render code with syntax highlighting markup
 * @param {string} content - Code content
 * @param {string} lang - Language for highlighting
 * @returns {string} HTML
 */
function renderCode(content, lang) {
  const escaped = escapeHtml(content);
  const langClass = lang ? `language-${lang}` : '';
  return `<pre><code class="${langClass}">${escaped}</code></pre>`;
}

/**
 * Render plain text
 * @param {string} content - Text content
 * @returns {string} HTML
 */
function renderText(content) {
  const escaped = escapeHtml(content);
  return `<pre class="plain-text">${escaped}</pre>`;
}

/**
 * Render a file and return content for the frontend
 * @param {string} filePath - Full path to the file
 * @returns {Promise<Object>} Rendered content and metadata
 */
export async function renderFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const fileType = getFileType(filePath);

  // Markdown files
  if (fileType.type === 'markdown') {
    // Check if it's a Marp presentation
    if (isMarp(content)) {
      const { html, css } = renderMarp(content);
      return {
        content: html,
        css,
        raw: content,
        fileType: 'markdown',
        isMarp: true
      };
    }

    // Regular markdown
    const html = renderMarkdown(content);
    return {
      content: html,
      raw: content,
      fileType: 'markdown',
      isMarp: false
    };
  }

  // Code files
  if (fileType.type === 'code') {
    const html = renderCode(content, fileType.lang);
    return {
      content: html,
      raw: content,
      fileType: 'code'
    };
  }

  // Plain text
  const html = renderText(content);
  return {
    content: html,
    raw: content,
    fileType: 'text'
  };
}

export default { renderFile };
