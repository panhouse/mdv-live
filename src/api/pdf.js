/**
 * PDF Export API
 * Uses marp-cli for Marp presentations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get path to local marp-cli binary
const marpBin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'marp');

/**
 * Setup PDF export routes
 * @param {Express} app - Express application
 */
export function setupPdfRoutes(app) {
  // Export Marp presentation to PDF
  app.post('/api/pdf/export', async (req, res) => {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const rootDir = app.locals.rootDir;
    const fullPath = path.join(rootDir, filePath);

    // Security check: ensure path is within rootDir
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Generate output path (same directory, .pdf extension)
    const outputPath = resolvedPath.replace(/\.md$/, '.pdf');
    const outputFileName = path.basename(outputPath);

    try {
      // Run marp-cli using local binary (faster than npx)
      // --no-stdin prevents waiting for stdin input
      const command = `"${marpBin}" "${resolvedPath}" -o "${outputPath}" --allow-local-files --no-stdin`;
      await execAsync(command, { timeout: 60000 });

      // Send PDF as download
      res.download(outputPath, outputFileName, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        // Optionally delete the PDF after download
        // fs.unlinkSync(outputPath);
      });
    } catch (error) {
      console.error('PDF export error:', error);
      res.status(500).json({
        error: 'PDF export failed',
        details: error.message
      });
    }
  });
}

export default setupPdfRoutes;
