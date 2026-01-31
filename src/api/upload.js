/**
 * File upload API routes
 */

import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { validatePath } from '../utils/path.js';

/**
 * Setup upload routes
 * @param {Express} app - Express app instance
 */
export function setupUploadRoutes(app) {
  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const targetPath = req.body.path || '';

      // Security check: validate relative path before joining
      if (!validatePath(targetPath, app.locals.rootDir)) {
        return cb(new Error('Access denied'));
      }

      const fullPath = path.join(app.locals.rootDir, targetPath);

      // Ensure directory exists
      try {
        await fs.mkdir(fullPath, { recursive: true });
        cb(null, fullPath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // パストラバーサル防止: ベース名のみ使用
      const safeName = path.basename(file.originalname);
      // null byteや制御文字を除去
      const sanitized = safeName.replace(/[\x00-\x1f]/g, '');
      cb(null, sanitized || 'unnamed');
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit
    }
  });

  // Upload files
  app.post('/api/upload', upload.array('files'), (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const uploaded = req.files.map(f => ({
        name: f.originalname,
        size: f.size
      }));

      res.json({ success: true, files: uploaded });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export default setupUploadRoutes;
