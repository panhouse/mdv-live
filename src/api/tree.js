/**
 * File tree API routes
 */

import fs from 'fs/promises';
import path from 'path';
import { getFileType } from '../utils/fileTypes.js';
import { validatePath } from '../utils/path.js';

/**
 * Build file tree for a directory
 * @param {string} dirPath - Directory path
 * @param {string} rootDir - Root directory for relative paths
 * @param {number} depth - Current depth (for limiting recursion)
 * @returns {Promise<Array>} Array of file/directory objects
 */
export async function buildFileTree(dirPath, rootDir, depth = 0) {
  const items = [];
  const maxInitialDepth = 1; // Only expand first level initially

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Sort: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      if (entry.name === '__pycache__') continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        const item = {
          type: 'directory',
          name: entry.name,
          path: relativePath,
          children: [],
          loaded: false
        };

        // Load children for first level
        if (depth < maxInitialDepth) {
          item.children = await buildFileTree(fullPath, rootDir, depth + 1);
          item.loaded = true;
        }

        items.push(item);
      } else {
        const fileType = getFileType(entry.name);
        items.push({
          type: 'file',
          name: entry.name,
          path: relativePath,
          icon: fileType.icon
        });
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }

  return items;
}

/**
 * Setup file tree routes
 * @param {Express} app - Express app instance
 */
export function setupTreeRoutes(app) {
  // Get full tree
  app.get('/api/tree', async (req, res) => {
    try {
      const tree = await buildFileTree(app.locals.rootDir, app.locals.rootDir);
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Expand a directory (lazy loading)
  app.get('/api/tree/expand', async (req, res) => {
    try {
      const { path: relativePath } = req.query;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);

      // Security: ensure path is within root
      if (!validatePath(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const children = await buildFileTree(fullPath, app.locals.rootDir, 0);
      res.json(children);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export default setupTreeRoutes;
