/**
 * Resolve the user-provided target path (positional argument to the
 * viewer command) to a root directory + optional initial file to open.
 *
 * Extracted from bin/mdv.js: the original called process.exit(1) directly
 * on a not-found path, which bypassed main()'s catch and made this
 * untestable without spawning a subprocess. It now throws UsageError
 * instead — main() is the only place that exits.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from './errors.js';

/**
 * @param {string} targetPath - User-provided path (CLI positional), '.' or falsy for cwd.
 * @returns {Promise<{rootDir: string, initialFile: string|null}>}
 */
export async function resolveTargetPath(targetPath) {
  if (!targetPath || targetPath === '.') {
    return { rootDir: process.cwd(), initialFile: null };
  }

  const resolved = path.resolve(targetPath);
  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      return { rootDir: resolved, initialFile: null };
    }
    if (stats.isFile()) {
      return { rootDir: path.dirname(resolved), initialFile: path.basename(resolved) };
    }
  } catch {
    throw new UsageError(`Error: Path not found: ${targetPath}`);
  }

  // Neither a directory nor a regular file (e.g. a socket/FIFO) — fall back
  // to serving cwd, matching the original implementation's behavior.
  return { rootDir: process.cwd(), initialFile: null };
}

export default resolveTargetPath;
