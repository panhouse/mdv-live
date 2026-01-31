/**
 * Path security utilities
 */

import path from 'path';

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
 * Convert absolute path to relative path with forward slashes
 * @param {string} fullPath - Absolute file path
 * @param {string} rootDir - Root directory
 * @returns {string} Relative path using forward slashes
 */
export function getRelativePath(fullPath, rootDir) {
  return path.relative(rootDir, fullPath).split(path.sep).join('/');
}
