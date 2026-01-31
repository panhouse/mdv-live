/**
 * PDF Export API
 * Uses marp-cli for Marp presentations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { validatePath } from '../utils/path.js';

const execAsync = promisify(exec);
const marpBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'node_modules',
  '.bin',
  'marp'
);

/**
 * Setup PDF export routes
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

    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const outputPath = fullPath.replace(/\.md$/, '.pdf');
    const outputFileName = path.basename(outputPath);
    const command = `"${marpBin}" "${fullPath}" -o "${outputPath}" --allow-local-files --no-stdin`;

    try {
      await execAsync(command, { timeout: 60000 });
      res.download(outputPath, outputFileName, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
      });
    } catch (err) {
      console.error('PDF export error:', err);
      res.status(500).json({
        error: 'PDF export failed',
        details: err.message
      });
    }
  });
}

export default setupPdfRoutes;
