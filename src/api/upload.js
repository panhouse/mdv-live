/**
 * File upload API routes
 */

import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';

import { validatePath } from '../utils/path.js';

const FILE_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB

/**
 * Sanitize filename to prevent path traversal and remove control characters
 * @param {string} originalName - Original filename from upload
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(originalName) {
  const baseName = path.basename(originalName);
  const sanitized = baseName.replace(/[\x00-\x1f]/g, '');
  return sanitized || 'unnamed';
}

/**
 * Setup upload routes
 * @param {Express} app - Express app instance
 * @returns {void}
 */
export function setupUploadRoutes(app) {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const targetPath = req.body.path || '';

      if (!validatePath(targetPath, app.locals.rootDir)) {
        return cb(new Error('Access denied'));
      }

      const fullPath = path.join(app.locals.rootDir, targetPath);

      try {
        await fs.mkdir(fullPath, { recursive: true });
        cb(null, fullPath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, sanitizeFilename(file.originalname));
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: FILE_SIZE_LIMIT }
  });

  app.post('/api/upload', upload.array('files'), (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploaded = req.files.map(file => ({
      name: file.originalname,
      size: file.size
    }));

    res.json({ success: true, files: uploaded });
  });
}

export default setupUploadRoutes;
