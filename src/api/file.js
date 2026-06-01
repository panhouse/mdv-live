/**
 * File operations API routes
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import mime from 'mime-types';
import WebSocket from 'ws';
import { getFileType } from '../utils/fileTypes.js';
import { renderFile } from '../rendering/index.js';
import { validatePathReal } from '../utils/path.js';

/**
 * Validate path and resolve to full path (with symlink protection)
 * @param {string} relativePath - Relative path to validate
 * @param {string} rootDir - Root directory
 * @returns {Promise<{ valid: boolean, fullPath: string }>} Validation result with full path
 */
async function resolveAndValidate(relativePath, rootDir) {
  if (!relativePath || !await validatePathReal(relativePath, rootDir)) {
    return { valid: false, fullPath: '' };
  }
  return { valid: true, fullPath: path.join(rootDir, relativePath) };
}

/**
 * Check whether a file or directory exists at the given path.
 * @param {string} fullPath - Absolute path
 * @returns {Promise<boolean>} True if it exists
 */
async function pathExists(fullPath) {
  return fs.access(fullPath).then(() => true).catch(() => false);
}

/**
 * Broadcast tree_update to all WebSocket clients
 * @param {Express} app - Express app instance
 * @returns {void}
 */
function broadcastTreeUpdate(app) {
  const wss = app.locals.wss;
  if (!wss) return;

  const message = JSON.stringify({ type: 'tree_update' });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Build download URL for a file
 * @param {string} relativePath - Relative path to file
 * @returns {string} Download URL
 */
function buildDownloadUrl(relativePath) {
  return `/api/download?path=${encodeURIComponent(relativePath)}`;
}

/**
 * Build response for binary files with appropriate media URLs
 * @param {string} name - File name
 * @param {object} fileType - File type info
 * @param {string} downloadUrl - Download URL
 * @returns {object} Response object
 */
function buildBinaryFileResponse(name, fileType, downloadUrl) {
  const response = {
    name,
    fileType: fileType.type,
    icon: fileType.icon,
    downloadUrl
  };

  switch (fileType.type) {
    case 'image':
      response.imageUrl = downloadUrl;
      break;
    case 'pdf':
      response.pdfUrl = downloadUrl;
      break;
    case 'video':
    case 'audio':
      response.mediaUrl = downloadUrl;
      break;
  }

  return response;
}

/**
 * Setup file routes
 * @param {Express} app - Express app instance
 * @returns {void}
 */
export function setupFileRoutes(app) {
  const { rootDir } = app.locals;

  // Serve raw files (for HTML preview with relative paths)
  app.get('/raw/*', async (req, res) => {
    const relativePath = req.params[0];
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath || !valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a file' });
      }

      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.sendFile(fullPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Get file content
  app.get('/api/file', async (req, res) => {
    const { path: relativePath } = req.query;
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }

      const fileType = getFileType(relativePath);
      const name = path.basename(relativePath);

      if (fileType.binary) {
        const downloadUrl = buildDownloadUrl(relativePath);
        return res.json(buildBinaryFileResponse(name, fileType, downloadUrl));
      }

      // HTML files: return htmlUrl for iframe preview + raw content for editing
      if (fileType.type === 'html') {
        const content = await fs.readFile(fullPath, 'utf-8');
        const escaped = content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
        return res.json({
          name,
          fileType: 'html',
          icon: 'html',
          htmlUrl: `/raw/${relativePath}`,
          content: `<pre><code class="language-html">${escaped}</code></pre>`,
          raw: content
        });
      }

      const relativeDir = path.dirname(relativePath);
      const rendered = await renderFile(fullPath, relativeDir === '.' ? '' : relativeDir);
      res.json({ name, ...rendered });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Save file content
  app.post('/api/file', async (req, res) => {
    const { path: relativePath, content } = req.body;
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      // Only a *new* file changes the tree structure; editing existing content
      // does not. Broadcasting tree_update on every autosave makes all clients
      // re-fetch and re-render the whole tree needlessly (a tree storm during
      // normal editing). Content updates already reach watchers via the
      // targeted file_update channel, so an existing-file save stays silent.
      const isNewFile = !(await pathExists(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
      if (isNewFile) broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete file or directory
  app.delete('/api/file', async (req, res) => {
    const { path: relativePath } = req.query;
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await fs.rm(fullPath, { recursive: true });
      } else {
        await fs.unlink(fullPath);
      }

      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Create directory
  app.post('/api/mkdir', async (req, res) => {
    const { path: relativePath } = req.body;
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      await fs.mkdir(fullPath, { recursive: true });
      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Move/rename file or directory
  app.post('/api/move', async (req, res) => {
    const { source, destination } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ error: 'Source and destination are required' });
    }

    const sourceResult = await resolveAndValidate(source, rootDir);
    const destResult = await resolveAndValidate(destination, rootDir);

    if (!sourceResult.valid || !destResult.valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      await fs.rename(sourceResult.fullPath, destResult.fullPath);
      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download file (with Range Request support for video/audio streaming)
  app.get('/api/download', async (req, res) => {
    const { path: relativePath } = req.query;
    const { valid, fullPath } = await resolveAndValidate(relativePath, rootDir);

    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (!valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a file' });
      }

      const rangeHeader = req.headers.range;
      if (!rangeHeader) {
        return res.sendFile(fullPath);
      }

      // Range Request for video/audio streaming
      const fileSize = stat.size;
      const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
      if (!match) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const start = Number(match[1]);
      if (start >= fileSize) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const end = Math.min(match[2] ? Number(match[2]) : fileSize - 1, fileSize - 1);
      if (end < start) {
        return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      }
      const chunkSize = end - start + 1;
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      createReadStream(fullPath, { start, end }).pipe(res);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.status(500).json({ error: err.message });
    }
  });
}

export default setupFileRoutes;
