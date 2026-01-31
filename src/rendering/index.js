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

  if (fileType.type === 'markdown') {
    return renderMarkdownFile(content);
  }

  if (fileType.type === 'code') {
    return {
      content: renderCode(content, fileType.lang),
      raw: content,
      fileType: 'code'
    };
  }

  return {
    content: renderText(content),
    raw: content,
    fileType: 'text'
  };
}

/**
 * Render markdown content, detecting Marp presentations
 * @param {string} content - Raw markdown content
 * @returns {Object} Rendered content and metadata
 */
function renderMarkdownFile(content) {
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

  return {
    content: renderMarkdown(content),
    raw: content,
    fileType: 'markdown',
    isMarp: false
  };
}

export default { renderFile };
