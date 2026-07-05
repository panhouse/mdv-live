/**
 * Path security utilities
 */

import path from 'path';
import fs from 'fs/promises';

/**
 * Validate that a path is within the allowed root directory.
 * Prevents path traversal attacks, null byte injection, and absolute path access.
 * @param {string} targetPath - Relative path to validate
 * @param {string} rootDir - Allowed root directory
 * @returns {boolean} True if path is safe and within rootDir
 */
export function validatePath(targetPath, rootDir) {
  // Reject null bytes (injection attack vector)
  if (targetPath.includes('\0') || targetPath.includes('%00')) {
    return false;
  }

  // Reject absolute paths
  if (path.isAbsolute(targetPath)) {
    return false;
  }

  // Reject path traversal attempts
  if (targetPath.includes('..')) {
    return false;
  }

  // Verify resolved path stays within root directory
  const resolved = path.resolve(rootDir, targetPath);
  const resolvedRoot = path.resolve(rootDir);

  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

/**
 * Validate path with symlink resolution.
 * Calls validatePath first, then verifies the real filesystem path stays within rootDir.
 * @param {string} targetPath - Relative path to validate
 * @param {string} rootDir - Allowed root directory
 * @returns {Promise<boolean>} True if path is safe after symlink resolution
 */
export async function validatePathReal(targetPath, rootDir) {
  if (!validatePath(targetPath, rootDir)) {
    return false;
  }

  const fullPath = path.resolve(rootDir, targetPath);
  try {
    const realPath = await fs.realpath(fullPath);
    const realRoot = await fs.realpath(rootDir);
    return realPath === realRoot || realPath.startsWith(realRoot + path.sep);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File/dir doesn't exist yet — walk up to find nearest existing ancestor
      const realRoot = await fs.realpath(rootDir);
      let current = fullPath;
      while (current !== path.dirname(current)) {
        current = path.dirname(current);
        try {
          const realAncestor = await fs.realpath(current);
          return realAncestor === realRoot || realAncestor.startsWith(realRoot + path.sep);
        } catch (e) {
          if (e.code !== 'ENOENT') return false;
          // Keep walking up
        }
      }
      return false;
    }
    return false;
  }
}

/**
 * Convert absolute path to relative path with forward slashes
 * @param {string} fullPath - Absolute file path
 * @param {string} rootDir - Root directory
 * @returns {string} Relative path using forward slashes
 */
export function getRelativePath(fullPath, rootDir) {
  return path.relative(rootDir, fullPath).split(path.sep).join('/');
}

/**
 * Validate a relative path (via validatePathReal, symlink-aware) and resolve
 * it to an absolute path within rootDir.
 *
 * SSOT replacement for the near-identical private `resolveAndValidate`
 * helpers that used to be duplicated across src/api/*.js (see
 * refactoring-2026-07-strategy.md Phase 2, item "resolveWithinRoot()").
 *
 * @param {string} relativePath - Relative path to validate
 * @param {string} rootDir - Root directory
 * @returns {Promise<{ valid: boolean, fullPath: string }>} Validation result with full path
 */
export async function resolveWithinRoot(relativePath, rootDir) {
  if (!relativePath || !await validatePathReal(relativePath, rootDir)) {
    return { valid: false, fullPath: '' };
  }
  return { valid: true, fullPath: path.join(rootDir, relativePath) };
}
