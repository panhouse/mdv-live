/**
 * Path security utilities
 */

import path from 'path';

/**
 * Validate that a path is within the allowed root directory
 * Prevents path traversal attacks
 * @param {string} targetPath - Path to validate (must be relative)
 * @param {string} rootDir - Allowed root directory
 * @returns {boolean} True if path is valid
 */
export function validatePath(targetPath, rootDir) {
  // Reject null bytes (null byte injection attack)
  if (targetPath.includes('\0') || targetPath.includes('%00')) {
    return false;
  }

  // Reject absolute paths (e.g., /etc/passwd)
  if (path.isAbsolute(targetPath)) {
    return false;
  }

  // Reject path traversal attempts
  if (targetPath.includes('..')) {
    return false;
  }

  const fullPath = path.join(rootDir, targetPath);
  const resolved = path.resolve(fullPath);
  const resolvedRoot = path.resolve(rootDir);

  // Check if the resolved path starts with the root directory
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

/**
 * Get relative path from root
 * @param {string} fullPath - Full path
 * @param {string} rootDir - Root directory
 * @returns {string} Relative path with forward slashes
 */
export function getRelativePath(fullPath, rootDir) {
  return path.relative(rootDir, fullPath).split(path.sep).join('/');
}

export default { validatePath, getRelativePath };
