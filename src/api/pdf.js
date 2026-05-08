import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { isMarp } from '../rendering/markdown.js';
import { validatePath } from '../utils/path.js';

const marpBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'node_modules',
  '.bin',
  'marp'
);
const PDF_EXPORT_TIMEOUT_MS = 180000;

/**
 * Spawn marp-cli with stdin closed.
 *
 * 注意: execFile は stdio オプションを受け付けない (Node 仕様) ため spawn を使う。
 */
function runMarp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(marpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
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
        resolve();
      } else {
        const err = new Error(`marp exited with code=${code} signal=${signal}`);
        err.code = code;
        err.signal = signal;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/**
 * Setup PDF export routes.
 *
 * Web UI からは Marp ファイルのみがこの経路を使う。通常 Markdown は
 * クライアント側で window.print() (OS 印刷ダイアログ) に流す設計のため、
 * このエンドポイントは Marp 以外を 415 で拒否する。
 *
 * @param {Express} app - Express application
 * @returns {void}
 */
export function setupPdfRoutes(app) {
  const { rootDir } = app.locals;

  app.post('/api/pdf/export', async (req, res) => {
    const { filePath } = req.body;

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
      if (!isMarp(content)) {
        return res.status(415).json({ error: 'Server-side PDF export supports Marp files only. Use the browser print dialog for regular Markdown.' });
      }

      await runMarp([fullPath, '-o', outputPath, '--html', '--allow-local-files', '--no-stdin']);

      res.download(outputPath, outputFileName, async (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        try { await fs.unlink(outputPath); } catch { /* ignore cleanup errors */ }
      });
    } catch (err) {
      console.error('PDF export error:', err);
      try { await fs.unlink(outputPath); } catch { /* ignore */ }
      res.status(500).json({ error: 'PDF export failed' });
    }
  });
}

export default setupPdfRoutes;
