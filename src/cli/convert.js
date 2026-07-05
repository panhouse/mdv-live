/**
 * `mdv convert` subcommand: markdown/Marp -> PDF orchestration.
 *
 * - Marp routing uses the canonical `isMarp()` (src/rendering/markdown.js,
 *   re-exported from src/rendering/marpitAdapter.js) instead of a
 *   re-implemented regex (P1 SSOT fix — the old bin/mdv.js copy was
 *   byte-identical to the canonical one, just duplicated).
 * - Never calls process.exit(); returns exit codes (or throws UsageError
 *   for argument validation) so bin/mdv.js's main() is the only exit point.
 * - The actual PDF-generation seams (exportMarpPdf / exportMarkdownPdf) are
 *   injectable so unit tests can verify routing/path decisions without
 *   invoking the real marp-cli / md-to-pdf binaries.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { isMarp } from '../rendering/markdown.js';
import { exportMarkdownPdf, exportMarpPdf } from '../services/pdf.js';
import { PRESETS, resolvePdfOptions, resolveStyle } from '../styles/index.js';
import { loadConfig } from './config.js';
import { UsageError } from './errors.js';

export const CONVERT_OPTIONS = {
  input: { type: 'string', short: 'i' },
  output: { type: 'string', short: 'o' },
  style: { type: 'string', short: 's' },
  'pdf-options': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

/**
 * Display convert subcommand help message.
 */
export function showConvertHelp() {
  const presetList = Object.keys(PRESETS).join(', ');
  console.log(`
MDV convert - Convert markdown to PDF

Usage: mdv convert -i <input.md> -o <output.pdf> [options]

Options:
  -i, --input <file>    Input markdown file (.md or .markdown)
  -o, --output <file>   Output PDF file (default: same name as input)
  -s, --style <preset>  Built-in preset or custom CSS file path
                        Built-in presets: ${presetList}
  --pdf-options <file>  JSON file with Puppeteer PDF options
  -h, --help            Show this help message

Config file (mdv.config.json in the current directory), CLI flags win:
  css         Same as --style (custom CSS file path)
  pdfOptions  Same as --pdf-options (JSON file path)

Examples:
  mdv convert -i slide.md -o slide.pdf
  mdv convert -i README.md -s ./src/styles/report.example.css --pdf-options ./src/styles/report.pdf-options.example.json
  mdv convert -i doc.md -o out.pdf -s ./my-style.css
`);
}

/**
 * Compute the default output PDF path for a resolved input markdown path.
 * @param {string} resolvedInputPath - Absolute (or already-resolved) input path.
 * @returns {string}
 */
export function computeDefaultOutputPath(resolvedInputPath) {
  return resolvedInputPath.replace(/\.(md|markdown)$/i, '.pdf');
}

/**
 * Format a PDF tool error for CLI output.
 * @param {Error} err
 * @returns {string} Error message including install hint when applicable.
 */
export function formatPdfToolError(err) {
  if (err.code === 'PDF_TOOL_UNAVAILABLE') {
    return `Error: ${err.message}\n  Run: npm install --include=optional`;
  }
  if (err.stderr) {
    return `Error: PDF conversion failed\n${err.stderr}`;
  }
  return `Error: PDF conversion failed\n${err.message || err}`;
}

/**
 * Convert Marp presentation to PDF using the shared service.
 *
 * @param {string} inputPath - Resolved input file path
 * @param {string} outputPath - Resolved output file path
 * @param {object} [deps]
 * @param {typeof exportMarpPdf} [deps.exportMarpPdf] - Injectable PDF generation seam.
 * @returns {Promise<number>} Exit code
 */
export async function convertMarpToPdf(inputPath, outputPath, { exportMarpPdf: exportMarp = exportMarpPdf } = {}) {
  try {
    await exportMarp(inputPath, outputPath);
    console.log(`PDF saved: ${outputPath}`);
    return 0;
  } catch (err) {
    console.error(formatPdfToolError(err));
    return 1;
  }
}

/**
 * Convert regular markdown to PDF using the shared service.
 *
 * @param {string} inputPath - Resolved input file path
 * @param {string} outputPath - Resolved output file path
 * @param {import('../styles/index.js').StyleConfig} styleConfig - Style preset
 * @param {object} [deps]
 * @param {typeof exportMarkdownPdf} [deps.exportMarkdownPdf] - Injectable PDF generation seam.
 * @returns {Promise<number>} Exit code
 */
export async function convertMarkdownToPdf(inputPath, outputPath, styleConfig, { exportMarkdownPdf: exportMd = exportMarkdownPdf } = {}) {
  console.log('Converting as document (A4 portrait)...');
  try {
    await exportMd(inputPath, outputPath, { styleConfig });
    console.log(`PDF saved: ${outputPath}`);
    return 0;
  } catch (err) {
    console.error(formatPdfToolError(err));
    return 1;
  }
}

/**
 * Convert markdown to PDF using the appropriate tool.
 * - Marp slides: use marp-cli (style option ignored)
 * - Regular markdown: use md-to-pdf with optional style preset
 *
 * Never calls process.exit(); returns an exit code.
 *
 * @param {string} inputPath - Input markdown file path
 * @param {string} [outputPath] - Output PDF file path
 * @param {string} [styleArg] - Style preset name or CSS file path
 * @param {string} [pdfOptionsPath] - JSON file with Puppeteer PDF options
 * @param {object} [deps] - Injectable seams (exportMarpPdf/exportMarkdownPdf/resolveStyle/resolvePdfOptions) for tests.
 * @returns {Promise<number>} Exit code (0 = success, 1 = error)
 */
export async function convertToPdf(inputPath, outputPath, styleArg, pdfOptionsPath, deps = {}) {
  const {
    resolveStyle: resolveStyleFn = resolveStyle,
    resolvePdfOptions: resolvePdfOptionsFn = resolvePdfOptions,
  } = deps;

  const resolved = path.resolve(inputPath);

  const fileExists = await fs.access(resolved).then(() => true).catch(() => false);
  if (!fileExists) {
    console.error(`Error: File not found: ${inputPath}`);
    return 1;
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!['.md', '.markdown'].includes(ext)) {
    console.error(`Error: Not a markdown file: ${inputPath}`);
    return 1;
  }

  const content = await fs.readFile(resolved, 'utf-8');
  const isMarpFile = isMarp(content);
  const defaultOutput = computeDefaultOutputPath(resolved);
  const finalOutput = outputPath ? path.resolve(outputPath) : defaultOutput;

  console.log(`Converting ${inputPath} to PDF...`);

  if (isMarpFile) {
    return convertMarpToPdf(resolved, finalOutput, deps);
  }

  let styleConfig;
  try {
    styleConfig = await resolveStyleFn(styleArg);
    styleConfig = {
      ...styleConfig,
      pdfOptions: await resolvePdfOptionsFn(pdfOptionsPath, styleConfig.pdfOptions),
    };
  } catch {
    console.error(`Error: Style or PDF options not found: ${styleArg || pdfOptionsPath}`);
    return 1;
  }

  return convertMarkdownToPdf(resolved, finalOutput, styleConfig, deps);
}

/**
 * Run the `convert` subcommand from parsed CLI values.
 *
 * Config precedence (CLI flags > mdv.config.json > built-in defaults) is
 * applied here: `mdv.config.json` is looked up in the current working
 * directory (convert has no "served directory" the way the viewer does).
 *
 * @param {{values: Record<string, unknown>}} parsed - Result of parseArgs for CONVERT_OPTIONS.
 * @returns {Promise<number>} Exit code
 */
export async function runConvert({ values }) {
  if (values.help) {
    showConvertHelp();
    return 0;
  }

  if (!values.input) {
    throw new UsageError('Error: -i <file.md> is required', { showHelp: showConvertHelp });
  }

  const config = await loadConfig(process.cwd());
  const styleArg = values.style || config.css;
  const pdfOptionsPath = values['pdf-options'] || config.pdfOptions;

  return convertToPdf(values.input, values.output, styleArg, pdfOptionsPath);
}

export default convertToPdf;
