/**
 * Resolve and read a deck file safely (path-traversal + symlink-following
 * defenses). Returns { rawSource, stat, realPath }. Throws coded errors:
 *   PATH_INVALID / NOT_FOUND.
 */

import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { validatePath, validatePathReal } from '../../utils/path.js';
import { mkError } from '../../utils/errors.js';

export async function readDeckSafely(rootDir, relativePath) {
  if (!validatePath(relativePath, rootDir)) throw mkError('PATH_INVALID');
  const ok = await validatePathReal(relativePath, rootDir);
  if (!ok) throw mkError('PATH_INVALID');

  const fullPath = path.resolve(rootDir, relativePath);
  let realPath;
  try {
    realPath = await fs.realpath(fullPath);
  } catch (err) {
    if (err.code === 'ENOENT') throw mkError('NOT_FOUND');
    throw err;
  }

  let fd;
  try {
    fd = await fs.open(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ELOOP') throw mkError('PATH_INVALID', 'symlink at terminal');
    if (err.code === 'ENOENT') throw mkError('NOT_FOUND');
    throw err;
  }
  try {
    const stat = await fd.stat();
    const rawSource = await fd.readFile('utf-8');
    return { rawSource, stat, realPath };
  } finally {
    await fd.close();
  }
}
