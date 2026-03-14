/**
 * Rendering module - combines markdown-it and marp-core
 */

import fs from 'fs/promises';
import path from 'path';
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
 * Rewrite relative image/video/audio src paths to /raw/ URLs
 * @param {string} html - Rendered HTML
 * @param {string} relativeDir - Directory of the source file relative to rootDir
 * @returns {string} HTML with rewritten paths
 */
function rewriteMediaPaths(html, relativeDir) {
  // Match src="..." that are not absolute URLs or data URIs
  return html.replace(
    /(<(?:img|video|audio|source)\s[^>]*?\bsrc=")([^"]+)(")/gi,
    (match, before, src, after) => {
      if (/^(https?:\/\/|data:|\/raw\/|\/)/.test(src)) return match;
      const resolved = relativeDir ? `${relativeDir}/${src}` : src;
      return `${before}/raw/${resolved}${after}`;
    }
  );
}

/**
 * Render a file and return content for the frontend
 * @param {string} filePath - Full path to the file
 * @param {string} [relativeDir] - Directory of the file relative to rootDir (for resolving relative paths)
 * @returns {Promise<Object>} Rendered content and metadata
 */
export async function renderFile(filePath, relativeDir) {
  const content = await fs.readFile(filePath, 'utf-8');
  const fileType = getFileType(filePath);

  if (fileType.type === 'markdown') {
    return renderMarkdownFile(content, relativeDir);
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
 * @param {string} [relativeDir] - Directory relative to rootDir for resolving image paths
 * @returns {Object} Rendered content and metadata
 */
function renderMarkdownFile(content, relativeDir) {
  if (isMarp(content)) {
    const { html, css } = renderMarp(content);
    return {
      content: rewriteMediaPaths(html, relativeDir),
      css,
      raw: content,
      fileType: 'markdown',
      isMarp: true
    };
  }

  return {
    content: rewriteMediaPaths(renderMarkdown(content), relativeDir),
    raw: content,
    fileType: 'markdown',
    isMarp: false
  };
}

export default { renderFile };
