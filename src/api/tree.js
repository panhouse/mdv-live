/**
 * File tree API routes
 */

import fs from 'fs/promises';
import path from 'path';
import { getFileType } from '../utils/fileTypes.js';
import { getRelativePath, validatePathReal } from '../utils/path.js';

const IGNORED_PATTERNS = new Set(['node_modules', '__pycache__', '.git']);
const MAX_INITIAL_DEPTH = 1;

/**
 * Check if an entry should be ignored
 * @param {string} name - Entry name
 * @returns {boolean} True if should be ignored
 */
function shouldIgnore(name) {
  return IGNORED_PATTERNS.has(name);
}

/**
 * Sort entries: directories first, then files, alphabetically
 * @param {fs.Dirent} a - First entry
 * @param {fs.Dirent} b - Second entry
 * @returns {number} Sort order
 */
function sortEntries(a, b) {
  const aIsDir = a.isDirectory();
  const bIsDir = b.isDirectory();
  if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Build file tree for a directory
 * @param {string} dirPath - Directory path
 * @param {string} rootDir - Root directory for relative paths
 * @param {number} depth - Current depth (for limiting recursion)
 * @returns {Promise<Array>} Array of file/directory objects
 */
export async function buildFileTree(dirPath, rootDir, depth = 0) {
  const items = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    entries.sort(sortEntries);

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = getRelativePath(fullPath, rootDir);

      if (entry.isDirectory()) {
        const shouldLoadChildren = depth < MAX_INITIAL_DEPTH;
        items.push({
          type: 'directory',
          name: entry.name,
          path: relativePath,
          children: shouldLoadChildren ? await buildFileTree(fullPath, rootDir, depth + 1) : [],
          loaded: shouldLoadChildren
        });
      } else {
        items.push({
          type: 'file',
          name: entry.name,
          path: relativePath,
          icon: getFileType(entry.name).icon
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

      // Security: validate before resolving path (with symlink check)
      if (!await validatePathReal(relativePath, app.locals.rootDir)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
      const children = await buildFileTree(fullPath, app.locals.rootDir, 0);
      res.json(children);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

export default setupTreeRoutes;
