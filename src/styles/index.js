/**
 * PDF style preset system.
 * Built-in styles are intentionally minimal; custom PDF styling is done by
 * passing a CSS file path to the convert command.
 */

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HIGHLIGHT_STYLES_DIR = path.resolve(path.dirname(require.resolve('highlight.js')), '..', 'styles');

const BASE_PDF_OPTIONS = {
  format: 'A4',
  margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
};

/**
 * @typedef {object} StyleConfig
 * @property {string | null} stylesheet - Single stylesheet path for custom CSS.
 * @property {string[]} [stylesheets] - Ordered stylesheet paths injected before md-to-pdf inline CSS.
 * @property {object} pdfOptions - Puppeteer PDF options passed to md-to-pdf.
 * @property {string} [highlightStyle] - highlight.js theme name used by md-to-pdf.
 * @property {string} [css] - Inline CSS injected after md-to-pdf stylesheets.
 */

/**
 * @typedef {Record<string, unknown>} PdfOptions
 */

/** @type {Record<string, StyleConfig>} */
export const PRESETS = {
  default: {
    stylesheet: null,
    pdfOptions: BASE_PDF_OPTIONS,
  },
};

/**
 * Resolve a style argument to a StyleConfig.
 * Accepts a built-in preset name or a path to a custom CSS file.
 *
 * @param {string | undefined} styleArg - Preset name or CSS file path
 * @returns {Promise<StyleConfig>}
 * @throws {Error} If a CSS file path is given but does not exist
 */
export async function resolveStyle(styleArg) {
  if (!styleArg) return PRESETS.default;

  if (Object.hasOwn(PRESETS, styleArg)) return PRESETS[styleArg];

  // Treat as a custom CSS file path
  const cssPath = path.resolve(styleArg);
  await fs.access(cssPath);
  return {
    stylesheet: cssPath,
    stylesheets: [
      path.join(HIGHLIGHT_STYLES_DIR, 'atom-one-dark.css'),
      cssPath,
    ],
    highlightStyle: 'atom-one-dark',
    pdfOptions: BASE_PDF_OPTIONS,
  };
}

/**
 * Resolve a JSON file containing Puppeteer PDF options.
 *
 * @param {string | undefined} pdfOptionsPath - JSON file path.
 * @param {object} baseOptions - Base options to merge into.
 * @returns {Promise<object>} Merged PDF options.
 * @throws {Error} If the file does not contain a JSON object.
 */
export async function resolvePdfOptions(pdfOptionsPath, baseOptions = BASE_PDF_OPTIONS) {
  if (!pdfOptionsPath) return baseOptions;

  const resolvedPath = path.resolve(pdfOptionsPath);
  const rawOptions = await fs.readFile(resolvedPath, 'utf-8');
  const parsedOptions = JSON.parse(rawOptions);

  if (!parsedOptions || typeof parsedOptions !== 'object' || Array.isArray(parsedOptions)) {
    throw new Error(`PDF options must be a JSON object: ${pdfOptionsPath}`);
  }

  return {
    ...baseOptions,
    ...parsedOptions,
  };
}
