/**
 * File tree API routes
 */

import fs from 'fs/promises';
import path from 'path';
import { MAX_CHILDREN_PER_DIR, MAX_INITIAL_DEPTH } from '../config/constants.js';
import { getFileType } from '../utils/fileTypes.js';
import { isIgnoredName } from '../utils/ignorePatterns.js';
import { mkError, sendError } from '../utils/errors.js';
import { getRelativePath, validatePathReal } from '../utils/path.js';

/**
 * Build a "load more" sentinel node for a truncated directory listing.
 * @param {string} dirRelativePath - Directory whose children were truncated ('' = root)
 * @param {number} offset - Number of children already returned
 * @param {number} total - Total visible children in the directory
 * @returns {{type: string, path: string, offset: number, total: number, remaining: number}}
 */
function moreNode(dirRelativePath, offset, total) {
  return { type: 'more', path: dirRelativePath, offset, total, remaining: total - offset };
}

/**
 * Read a directory's visible entries, sorted (directories first, then files).
 * @param {string} dirPath - Directory path
 * @returns {Promise<fs.Dirent[]>} Filtered + sorted entries
 */
async function readVisibleEntries(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const visible = entries.filter((entry) => !isIgnoredName(entry.name));
  visible.sort(sortEntries);
  return visible;
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
    const visible = await readVisibleEntries(dirPath);
    const shown = visible.slice(0, MAX_CHILDREN_PER_DIR);

    for (const entry of shown) {
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

    if (visible.length > MAX_CHILDREN_PER_DIR) {
      items.push(moreNode(getRelativePath(dirPath, rootDir), MAX_CHILDREN_PER_DIR, visible.length));
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }

  return items;
}

/**
 * Read one page of a directory's direct children (no lookahead). Backs
 * /api/tree/page so the remainder of a large directory can be revealed on
 * demand instead of all at once.
 * @param {string} dirPath - Directory path
 * @param {string} rootDir - Root directory for relative paths
 * @param {number} offset - Index of the first child to return
 * @param {number} limit - Maximum children to return
 * @returns {Promise<Array>} Page items (subdirectories unloaded), plus a
 *   trailing "more" sentinel when further children remain.
 */
export async function readDirPage(dirPath, rootDir, offset, limit) {
  const items = [];

  try {
    const visible = await readVisibleEntries(dirPath);
    const slice = visible.slice(offset, offset + limit);

    for (const entry of slice) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = getRelativePath(fullPath, rootDir);

      if (entry.isDirectory()) {
        items.push({ type: 'directory', name: entry.name, path: relativePath, children: [], loaded: false });
      } else {
        items.push({ type: 'file', name: entry.name, path: relativePath, icon: getFileType(entry.name).icon });
      }
    }

    const nextOffset = offset + slice.length;
    if (visible.length > nextOffset) {
      items.push(moreNode(getRelativePath(dirPath, rootDir), nextOffset, visible.length));
    }
  } catch (err) {
    console.error(`Error reading directory page ${dirPath}:`, err);
  }

  return items;
}

/**
 * Setup file tree routes
 * @param {Express} app - Express app instance
 */
export function setupTreeRoutes(app) {
  // Get the top level of the tree. Direct children only (subdirectories come
  // back unloaded), same as expand. Without this depth argument the initial
  // load eagerly materialized one level of grandchildren into hidden DOM — a
  // root with many large subdirectories could mount tens of thousands of nodes
  // up front and freeze the tab. Each folder now loads its children on expand.
  app.get('/api/tree', async (req, res) => {
    try {
      const tree = await buildFileTree(app.locals.rootDir, app.locals.rootDir, MAX_INITIAL_DEPTH);
      res.json(tree);
    } catch (err) {
      sendError(res, mkError('READ_FAILED', err.message, { cause: err }));
    }
  });

  // Expand a directory (lazy loading)
  app.get('/api/tree/expand', async (req, res) => {
    try {
      const { path: relativePath } = req.query;
      if (!relativePath) {
        return sendError(res, mkError('PATH_REQUIRED', 'Path is required'));
      }

      // Security: validate before resolving path (with symlink check)
      if (!await validatePathReal(relativePath, app.locals.rootDir)) {
        return sendError(res, mkError('ACCESS_DENIED', 'Access denied'));
      }

      const fullPath = path.join(app.locals.rootDir, relativePath);
      // Direct children only: start at the depth cap so subdirectories come
      // back unloaded (loaded:false, children:[]). Lazy-loading one level per
      // expand avoids reading a whole grandchild level on every expand of a
      // wide directory (which made expanding/restoring large trees expensive).
      const children = await buildFileTree(fullPath, app.locals.rootDir, MAX_INITIAL_DEPTH);
      res.json(children);
    } catch (err) {
      sendError(res, mkError('READ_FAILED', err.message, { cause: err }));
    }
  });

  // Load one more page of a large directory's children (lazy pagination).
  app.get('/api/tree/page', async (req, res) => {
    try {
      const relativePath = typeof req.query.path === 'string' ? req.query.path : '';
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const requested = parseInt(req.query.limit, 10) || MAX_CHILDREN_PER_DIR;
      const limit = Math.min(MAX_CHILDREN_PER_DIR, Math.max(1, requested));

      // '' = root (always inside rootDir); any other path must validate.
      if (relativePath && !await validatePathReal(relativePath, app.locals.rootDir)) {
        return sendError(res, mkError('ACCESS_DENIED', 'Access denied'));
      }

      const dirPath = relativePath
        ? path.join(app.locals.rootDir, relativePath)
        : app.locals.rootDir;
      const items = await readDirPage(dirPath, app.locals.rootDir, offset, limit);
      res.json(items);
    } catch (err) {
      sendError(res, mkError('READ_FAILED', err.message, { cause: err }));
    }
  });
}

export default setupTreeRoutes;
