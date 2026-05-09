import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { isMarp } from '../rendering/markdown.js';
import { validatePath, validatePathReal } from '../utils/path.js';
import { resolvePdfOptions } from '../styles/index.js';

const require = createRequire(import.meta.url);
const highlightStylesheet = path.resolve(path.dirname(require.resolve('highlight.js')), '..', 'styles', 'atom-one-dark.css');
const PDF_EXPORT_TIMEOUT_MS = 180000;

/**
 * Lazily resolve a package's bin script via require.resolve.
 *
 * 0.5.10〜0.5.12 の hoist 罠 + optionalDependencies 欠如対応:
 * - npm hoisting で実体パスが top-level / nested いずれにもなる
 * - optionalDep が欠ける環境 (--omit=optional) では import 時に throw すると
 *   サーバー起動が壊れる → request 時に lazy で解決し、欠ければ 503
 *
 * @param {string} pkgName - npm package name (e.g. '@marp-team/marp-cli')
 * @param {string} binName - bin entry key (matches package.json bin)
 * @returns {string} Absolute path to the bin script
 * @throws {Error} `code === 'PDF_TOOL_UNAVAILABLE'` if package missing
 */
function resolvePkgBin(pkgName, binName) {
  let pkgPath;
  try {
    pkgPath = require.resolve(`${pkgName}/package.json`);
  } catch (err) {
    const e = new Error(`${pkgName} is not installed.`);
    e.code = 'PDF_TOOL_UNAVAILABLE';
    e.cause = err;
    throw e;
  }
  const pkg = require(`${pkgName}/package.json`);
  const bin = pkg.bin;
  const binRel = typeof bin === 'string' ? bin : bin?.[binName];
  if (!binRel) {
    const e = new Error(`${pkgName} does not declare a "${binName}" bin entry.`);
    e.code = 'PDF_TOOL_UNAVAILABLE';
    throw e;
  }
  return path.join(path.dirname(pkgPath), binRel);
}

/**
 * Spawn a PDF tool with stdin closed.
 *
 * 注意: execFile は stdio オプションを受け付けない (Node 仕様)。md-to-pdf は
 * 内部で get-stdin を呼ぶため、stdin が pipe のままだと EOF を永遠に待ち続けて
 * ハングする。spawn で stdin を 'ignore' (= /dev/null) に明示的に縛る。
 */
function runPdfTool(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, PDF_EXPORT_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`${path.basename(bin)} exited with code=${code} signal=${signal}`);
        err.code = code;
        err.signal = signal;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/**
 * Resolve an optional user-selected file path under the server root.
 * @param {string | undefined} relativePath - Path supplied by the web UI.
 * @param {string} rootDir - Server root directory.
 * @returns {Promise<string | null>} Absolute path or null.
 */
async function resolveOptionalUserFile(relativePath, rootDir) {
  if (!relativePath) return null;
  if (!await validatePathReal(relativePath, rootDir)) {
    throw new Error(`Access denied: ${relativePath}`);
  }
  const fullPath = path.join(rootDir, relativePath);
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  return fullPath;
}

/**
 * Export a regular markdown document with md-to-pdf.
 *
 * `md-to-pdf` is in regular `dependencies`. With user-supplied stylesheet
 * and PDF options JSON (via Web UI Style panel or CLI), apply them.
 */
async function exportMarkdownPdf(inputPath, outputPath, stylesheetPath, pdfOptionsPath) {
  const mdToPdfBin = resolvePkgBin('md-to-pdf', 'md-to-pdf');
  const pdfOptions = await resolvePdfOptions(pdfOptionsPath || undefined);
  const args = [inputPath, '--pdf-options', JSON.stringify(pdfOptions)];

  if (stylesheetPath) {
    args.push('--stylesheet', highlightStylesheet);
    args.push('--stylesheet', stylesheetPath);
    args.push('--highlight-style', 'atom-one-dark');
  }

  await runPdfTool(mdToPdfBin, args, { cwd: path.dirname(inputPath) });

  const generatedPdf = inputPath.replace(/\.(md|markdown)$/i, '.pdf');
  await fs.rename(generatedPdf, outputPath);
}

/**
 * Export a Marp slide deck with marp-cli.
 *
 * `@marp-team/marp-cli` is an optionalDependency. When missing the route
 * returns a 503; that is surfaced by the caller.
 */
async function exportMarpPdf(inputPath, outputPath) {
  const marpBin = resolvePkgBin('@marp-team/marp-cli', 'marp');
  await runPdfTool(marpBin, [inputPath, '-o', outputPath, '--html', '--allow-local-files', '--no-stdin']);
}

/**
 * Setup PDF export routes.
 *
 * - Marp files → `marp-cli` (slide PDF, landscape, themed)
 * - Plain Markdown → `md-to-pdf` (document PDF, optional CSS / PDF options)
 *
 * @param {Express} app - Express application
 * @returns {void}
 */
export function setupPdfRoutes(app) {
  const { rootDir } = app.locals;

  app.post('/api/pdf/export', async (req, res) => {
    const { filePath, stylePath, pdfOptionsPath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    if (!validatePath(filePath, rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fullPath = path.join(rootDir, filePath);
    const baseName = path.basename(fullPath, '.md');
    const outputPath = path.join(os.tmpdir(), `mdv-${Date.now()}-${baseName}.pdf`);
    const outputFileName = `${baseName}.pdf`;

    try {
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }
      if (!stat.isFile()) {
        return res.status(404).json({ error: 'File not found' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      if (isMarp(content)) {
        await exportMarpPdf(fullPath, outputPath);
      } else {
        const [stylesheetPath, resolvedPdfOptionsPath] = await Promise.all([
          resolveOptionalUserFile(stylePath, rootDir),
          resolveOptionalUserFile(pdfOptionsPath, rootDir),
        ]);
        await exportMarkdownPdf(fullPath, outputPath, stylesheetPath, resolvedPdfOptionsPath);
      }

      res.download(outputPath, outputFileName, async (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        try { await fs.unlink(outputPath); } catch { /* ignore cleanup errors */ }
      });
    } catch (err) {
      console.error('PDF export error:', err);
      try { await fs.unlink(outputPath); } catch { /* ignore */ }
      if (err.code === 'PDF_TOOL_UNAVAILABLE') {
        return res.status(503).json({
          error: `PDF tool unavailable: ${err.message} Run \`npm install\` (without --omit=optional) and retry.`,
        });
      }
      res.status(500).json({ error: 'PDF export failed' });
    }
  });
}

export default setupPdfRoutes;
