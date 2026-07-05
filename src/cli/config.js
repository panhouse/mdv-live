/**
 * Project config file loader (Phase 4 new feature).
 *
 * Recognized file: `mdv.config.json`, read from `rootDir` — for the viewer
 * command that's "the directory mdv serves" (the resolved target
 * directory); for `mdv convert` (which has no "served directory") it's the
 * current working directory the command was invoked from.
 *
 * Precedence, applied by the callers that resolve final option values
 * (src/cli/registry.js's runViewer, src/cli/convert.js's runConvert):
 *   CLI flags > mdv.config.json > built-in defaults (src/config/constants.js)
 *
 * This module only loads + validates the file; it does not know about CLI
 * flags or defaults.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { UsageError } from './errors.js';

export const CONFIG_FILENAME = 'mdv.config.json';

const KNOWN_KEYS = ['port', 'depth', 'css', 'pdfOptions', 'open'];

/**
 * Load and validate `mdv.config.json` from `rootDir`.
 *
 * - Absent file → `{}`.
 * - Malformed JSON or a JSON value that isn't a plain object → throws
 *   UsageError naming the file.
 * - Unknown keys → `console.warn` once, listing all of them, then ignored.
 * - `css` / `pdfOptions` are resolved to absolute paths (relative to
 *   `rootDir`, i.e. relative to the config file itself) so callers never
 *   need to know where the config file lived.
 * - Recognized keys with the wrong type are silently dropped (treated as
 *   absent) rather than erroring — a config file is optional convenience,
 *   not a strict schema contract.
 *
 * @param {string} rootDir - Directory to look for mdv.config.json in.
 * @returns {Promise<{port?: number, depth?: number, css?: string, pdfOptions?: string, open?: boolean}>}
 */
export async function loadConfig(rootDir) {
  const configPath = path.join(rootDir, CONFIG_FILENAME);

  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new UsageError(`Error: could not read ${configPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`Error: ${configPath} is not valid JSON: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`Error: ${configPath} must contain a JSON object`);
  }

  const unknownKeys = Object.keys(parsed).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    console.warn(`Warning: ignoring unknown key(s) in ${configPath}: ${unknownKeys.join(', ')}`);
  }

  const config = {};
  if (typeof parsed.port === 'number') config.port = parsed.port;
  if (typeof parsed.depth === 'number') config.depth = parsed.depth;
  if (typeof parsed.open === 'boolean') config.open = parsed.open;
  if (typeof parsed.css === 'string') {
    config.css = path.resolve(rootDir, parsed.css);
    // Raw (rootDir-relative) form, for consumers that speak relative
    // paths — the viewer's PDF style panel sends rootDir-relative paths
    // to /api/pdf/export, so it needs the value as written.
    config.cssRaw = parsed.css;
  }
  if (typeof parsed.pdfOptions === 'string') {
    config.pdfOptions = path.resolve(rootDir, parsed.pdfOptions);
    config.pdfOptionsRaw = parsed.pdfOptions;
  }

  return config;
}

export default loadConfig;
