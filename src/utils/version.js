/**
 * Single source of truth for reading this package's version.
 *
 * Replaces the duplicated `readFileSync(...) + JSON.parse(...)` of
 * package.json in `src/server.js` and `bin/mdv.js`. Read once and cached —
 * package.json does not change while the process is running.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');

let cachedVersion = null;

/**
 * Get the package version from package.json.
 * @returns {string} Semantic version string (e.g. "0.5.22")
 */
export function getVersion() {
  if (cachedVersion === null) {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
    cachedVersion = pkg.version;
  }
  return cachedVersion;
}

export default getVersion;
