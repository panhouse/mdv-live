/**
 * File upload API routes
 */

import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';

import { UPLOAD_FILE_SIZE_LIMIT } from '../config/constants.js';
import { ERROR_STATUS, mkError, sendError } from '../utils/errors.js';
import { validatePathReal } from '../utils/path.js';
import { makeOriginGuard } from './middleware/originGuard.js';

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

      // Symlink-aware check (SECURITY fix): the sync validatePath() alone
      // would accept a path whose real target escapes rootDir via a
      // symlinked directory. validatePathReal() runs those same checks
      // first, then verifies the realpath, matching the rigor tree.js/pdf.js
      // already apply to user-supplied paths.
      if (!await validatePathReal(targetPath, app.locals.rootDir)) {
        return cb(mkError('ACCESS_DENIED', 'Access denied'));
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
    limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT }
  });

  // CSRF / DNS-rebinding defence (P1 fix): mutation route, so it gets the
  // same Origin/Host guard as /api/shutdown and the marpNote mutation routes
  // (allow-list read per request from app.locals — see the contract note in
  // src/server.js's createMdvServer). Runs BEFORE multer touches the
  // request, so a rejected cross-origin request never reaches disk.
  const originGuard = makeOriginGuard();

  app.post('/api/upload', originGuard, (req, res) => {
    // Invoke multer directly (rather than as declarative route middleware)
    // so its errors — MulterError (e.g. oversize -> LIMIT_FILE_SIZE) and the
    // ACCESS_DENIED error thrown from destination() above — are funneled
    // through sendError()/mkError() instead of falling through to Express's
    // default (non-JSON) error handler.
    upload.array('files')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, mkError('PAYLOAD_TOO_LARGE', 'File exceeds the upload size limit', { cause: err }));
        }
        if (err.code && err.code in ERROR_STATUS) {
          return sendError(res, err);
        }
        console.error('Upload error:', err);
        return sendError(res, mkError('WRITE_FAILED', 'Upload failed', { cause: err }));
      }

      if (!req.files || req.files.length === 0) {
        return sendError(res, mkError('NO_FILES_UPLOADED', 'No files uploaded'));
      }

      const uploaded = req.files.map(file => ({
        name: file.originalname,
        size: file.size
      }));

      res.json({ success: true, files: uploaded });
    });
  });
}

export default setupUploadRoutes;
