/**
 * File operations API routes
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getFileType } from '../utils/fileTypes.js';
import { renderFile } from '../rendering/index.js';
import { validatePath } from '../utils/path.js';

/**
 * Broadcast tree_update to all WebSocket clients
 * @param {Express} app - Express app instance
 */
function broadcastTreeUpdate(app) {
  const wss = app.locals.wss;
  if (wss) {
    const message = JSON.stringify({ type: 'tree_update' });
    wss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    });
  }
}

/**
 * Setup file routes
 * @param {Express} app - Express app instance
 */
export function setupFileRoutes(app) {
  // Get file content
  app.get('/api/file', async (req, res) => {
    try {
      const { path: relativePath } = req.query;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check (must use relativePath, not fullPath)
      if (!validatePath(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }

      const fileType = getFileType(relativePath);
      const name = path.basename(relativePath);

      // Handle binary files
      if (fileType.binary) {
        return res.json({
          name,
          fileType: fileType.type,
          icon: fileType.icon,
          downloadUrl: `/api/download?path=${encodeURIComponent(relativePath)}`,
          // Special URLs for media types
          ...(fileType.type === 'image' && {
            imageUrl: `/api/download?path=${encodeURIComponent(relativePath)}`
          }),
          ...(fileType.type === 'pdf' && {
            pdfUrl: `/api/download?path=${encodeURIComponent(relativePath)}`
          }),
          ...(['video', 'audio'].includes(fileType.type) && {
            mediaUrl: `/api/download?path=${encodeURIComponent(relativePath)}`
          })
        });
      }

      // Read and render text files
      const rendered = await renderFile(fullPath);

      res.json({
        name,
        ...rendered
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Save file content
  app.post('/api/file', async (req, res) => {
    try {
      const { path: relativePath, content } = req.body;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check (must use relativePath, not fullPath)
      if (!validatePath(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
      await fs.writeFile(fullPath, content, 'utf-8');
      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete file or directory
  app.delete('/api/file', async (req, res) => {
    try {
      const { path: relativePath } = req.query;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check (must use relativePath, not fullPath)
      if (!validatePath(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
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
    try {
      const { path: relativePath } = req.body;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check (must use relativePath, not fullPath)
      if (!validatePath(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
      await fs.mkdir(fullPath, { recursive: true });
      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Move/rename file or directory
  app.post('/api/move', async (req, res) => {
    try {
      const { source, destination } = req.body;
      if (!source || !destination) {
        return res.status(400).json({ error: 'Source and destination are required' });
      }

      // Security check (must use relative paths, not full paths)
      if (!validatePath(source, app.locals.rootDir) ||
          !validatePath(destination, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const sourcePath = path.join(app.locals.rootDir, source);
      const destPath = path.join(app.locals.rootDir, destination);
      await fs.rename(sourcePath, destPath);
      broadcastTreeUpdate(app);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download file (with Range Request support for video/audio streaming)
  app.get('/api/download', async (req, res) => {
    const { path: relativePath } = req.query;
    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Security check (must use relativePath, not fullPath)
    if (!validatePath(relativePath, app.locals.rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fullPath = path.join(app.locals.rootDir, relativePath);

    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a file' });
      }

      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Range Request対応（動画/音声ストリーミング用）
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });

        const stream = createReadStream(fullPath, { start, end });
        stream.pipe(res);
      } else {
        // 通常のファイル送信
        res.sendFile(fullPath);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.status(500).json({ error: err.message });
    }
  });
}

export default setupFileRoutes;
