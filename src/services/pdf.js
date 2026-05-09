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
import { randomUUID } from 'crypto';
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
 * 課題:
 *  - md-to-pdf CLI は出力ファイルを **ソース隣に同名 .pdf で書く** 仕様
 *    (例: foo.md → foo.pdf next to source)。既存の foo.pdf を上書きしないこと
 *  - 同時に、`![logo](images/logo.png)` のような **相対 asset 参照** を解決
 *    するためには md-to-pdf を **source dir で実行** する必要がある
 *    (`--basedir` を別dir にすると md-to-pdf が input path から URL を逆算
 *    して basedir 外と判定し asset がロードされない、codex round 2 P2)
 *
 * 解決:
 *  - source dir 内に **隠し一意名 (`.mdv-pdf-tmp.<stamp>.md`)** で copy 配置
 *  - md-to-pdf を source dir で実行 → 隠しPDFが source dir に生まれる
 *  - その隠し PDF を outputPath に rename
 *  - finally で隠し md / 隠し pdf を確実に削除 (source dir 残留物ゼロ)
 *
 * 副作用 / 制約:
 *  - source dir に書き込み権が必要 (read-only dir では fs.copyFile が
 *    EACCES/EROFS で throw → caller 側で 503/exit 1 を返す扱いに任せる)
 *  - 一意名 + mdv prefix なので既存ファイル衝突なし
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
  const ext = path.extname(inputPath); // .md / .markdown
  // randomUUID で temp 名を一意に。process.pid + Date.now() だと同一 ms の
  // concurrent 呼出 (例: 並行 /api/pdf/export) で衝突して別リクエストの
  // 入力/出力を上書きする race があった (codex round 3 P2)
  const stamp = `${process.pid}-${randomUUID()}`;
  const tempSourcePath = path.join(sourceDir, `.mdv-pdf-tmp.${stamp}${ext}`);
  const tempPdfPath = tempSourcePath.replace(/\.(md|markdown)$/i, '.pdf');

  try {
    await fs.copyFile(inputPath, tempSourcePath);

    const args = [tempSourcePath, '--pdf-options', JSON.stringify(pdfOptions)];

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

    await runPdfTool(mdToPdfBin, args, { cwd: sourceDir });
    await fs.rename(tempPdfPath, outputPath);
  } finally {
    // 隠し md / 隠し pdf を確実に削除 (例外発生時も cleanup)
    await fs.unlink(tempSourcePath).catch(() => {});
    await fs.unlink(tempPdfPath).catch(() => {});
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
