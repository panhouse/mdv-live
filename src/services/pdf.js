/**
 * PDF generation service.
 *
 * 中央集約された PDF 化ロジック:
 * - サーバー HTTP route (`src/api/pdf.js`) と CLI (`bin/mdv.js convert`) の
 *   両方が同じ実装を共有することで、bug fix・security check・hoist 対応・
 *   stdin pipe ハング対応・workspace 汚染回避ロジックを 1 箇所に集める
 * - Marp は `@marp-team/marp-cli` (optionalDependency)
 * - Plain markdown は `md-to-pdf` (optionalDependency: 0.5.15 で降格)
 * - どちらも欠如時は `PDF_TOOL_UNAVAILABLE` code を投げ、caller 側で
 *   ユーザー向けメッセージに変換 (HTTP 503 / CLI exit 1)
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { resolvePdfOptions } from '../styles/index.js';

const require = createRequire(import.meta.url);

const highlightStylesheet = path.resolve(
  path.dirname(require.resolve('highlight.js')),
  '..',
  'styles',
  'atom-one-dark.css',
);

const PDF_EXPORT_TIMEOUT_MS = 180000;

/**
 * Lazily resolve a package's bin script via require.resolve.
 *
 * 0.5.10〜0.5.12 の hoist 罠 + optionalDependencies 欠如対応:
 * - npm hoisting で実体パスが top-level / nested いずれにもなる
 * - optionalDep が欠ける環境 (--omit=optional) では import 時に throw すると
 *   サーバー起動が壊れる → request 時に lazy で解決し、欠ければ 503 / exit 1
 *
 * @param {string} pkgName - npm package name (e.g. '@marp-team/marp-cli')
 * @param {string} binName - bin entry key (matches package.json bin)
 * @returns {string} Absolute path to the bin script
 * @throws {Error} `code === 'PDF_TOOL_UNAVAILABLE'` if package missing
 */
export function resolvePkgBin(pkgName, binName) {
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
 * Export a regular markdown document with md-to-pdf.
 *
 * 注意 1: md-to-pdf CLI は出力ファイルを **ソース隣に同名 .pdf で書く** 仕様
 * (例: foo.md → foo.pdf next to source)。既存の foo.pdf があると上書きして
 * しまう。これを避けるためソースを **temp dir にコピー** してそこで実行し、
 * 生成 PDF だけを最終 outputPath に rename する。
 *
 * 注意 2: source dir に asset (`images/logo.png` 等の相対参照) がある場合に
 * temp copy だと参照が壊れるので、`--basedir` で source dir を渡して
 * relative asset 解決を維持する (codex round 1 P2 対策)。
 *
 * @param {string} inputPath - Source markdown file (absolute).
 * @param {string} outputPath - Destination PDF file (absolute).
 * @param {object} [options]
 * @param {string|null} [options.stylesheetPath] - Custom CSS file path.
 * @param {string|null} [options.pdfOptionsPath] - PDF options JSON path.
 * @param {object} [options.styleConfig] - Pre-resolved style config (CLI use).
 *   When supplied, supersedes stylesheetPath / pdfOptionsPath.
 * @returns {Promise<void>}
 */
export async function exportMarkdownPdf(inputPath, outputPath, options = {}) {
  const { stylesheetPath = null, pdfOptionsPath = null, styleConfig = null } = options;

  const mdToPdfBin = resolvePkgBin('md-to-pdf', 'md-to-pdf');
  const pdfOptions = styleConfig?.pdfOptions
    ?? await resolvePdfOptions(pdfOptionsPath || undefined);

  const sourceDir = path.dirname(inputPath);
  const tempSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-md-'));
  try {
    const tempSourcePath = path.join(tempSourceDir, path.basename(inputPath));
    await fs.copyFile(inputPath, tempSourcePath);

    // --basedir で source dir を asset 解決の base に指定。これで
    // ![logo](images/logo.png) のような相対参照が source dir から解決される
    const args = [
      tempSourcePath,
      '--basedir', sourceDir,
      '--pdf-options', JSON.stringify(pdfOptions),
    ];

    // CLI 経路: styleConfig (resolveStyle 済み) を優先
    if (styleConfig) {
      const stylesheetPaths = styleConfig.stylesheets
        ?? (styleConfig.stylesheet ? [styleConfig.stylesheet] : []);
      for (const ssPath of stylesheetPaths) {
        args.push('--stylesheet', ssPath);
      }
      if (styleConfig.highlightStyle) {
        args.push('--highlight-style', styleConfig.highlightStyle);
      }
      if (styleConfig.css) {
        args.push('--css', styleConfig.css);
      }
    } else if (stylesheetPath) {
      // Web UI 経路: 単一 CSS path + デフォルト highlight
      args.push('--stylesheet', highlightStylesheet);
      args.push('--stylesheet', stylesheetPath);
      args.push('--highlight-style', 'atom-one-dark');
    }

    await runPdfTool(mdToPdfBin, args, { cwd: tempSourceDir });

    const generatedPdf = tempSourcePath.replace(/\.(md|markdown)$/i, '.pdf');
    await fs.rename(generatedPdf, outputPath);
  } finally {
    await fs.rm(tempSourceDir, { recursive: true, force: true });
  }
}

/**
 * Export a Marp slide deck with marp-cli.
 *
 * @param {string} inputPath - Source Marp markdown file (absolute).
 * @param {string} outputPath - Destination PDF file (absolute).
 * @returns {Promise<void>}
 */
export async function exportMarpPdf(inputPath, outputPath) {
  const marpBin = resolvePkgBin('@marp-team/marp-cli', 'marp');
  await runPdfTool(marpBin, [
    inputPath,
    '-o', outputPath,
    '--html',
    '--allow-local-files',
    '--no-stdin',
  ]);
}
