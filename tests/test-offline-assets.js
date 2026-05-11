/**
 * Offline-asset regression tests.
 *
 * Asserts that the HTML / JS the server hands to the browser never references
 * an external http(s) CDN, and that every offline replacement actually exists
 * under src/static/vendor/.
 */

import assert from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const staticDir = path.join(repoRoot, 'src/static');
const vendorDir = path.join(staticDir, 'vendor');

const SERVED_SOURCES = [
  'index.html',
  'presenter.html',
  'app.js',
];

const REQUIRED_VENDOR_FILES = [
  'highlight.min.js',
  'highlight/github.min.css',
  'highlight/github-dark.min.css',
  'mermaid.min.js',
  'html2pdf.bundle.min.js',
  'tailwind.min.js',
];

const EXTERNAL_URL_RE = /https?:\/\/(?:cdn|cdnjs|jsdelivr|unpkg|tailwindcss)\b[^\s"'`)]+/gi;

describe('offline asset bundling', () => {
  for (const rel of SERVED_SOURCES) {
    it(`${rel} does not load any third-party CDN at runtime`, async () => {
      const filePath = path.join(staticDir, rel);
      const source = await readFile(filePath, 'utf8');
      const matches = source.match(EXTERNAL_URL_RE) || [];
      assert.deepStrictEqual(
        matches,
        [],
        `${rel} references CDN URLs at runtime: ${matches.join(', ')}`,
      );
    });
  }

  for (const rel of REQUIRED_VENDOR_FILES) {
    it(`vendor/${rel} exists and is non-empty`, async () => {
      const filePath = path.join(vendorDir, rel);
      const info = await stat(filePath);
      assert.ok(info.isFile(), `vendor/${rel} is not a regular file`);
      assert.ok(info.size > 0, `vendor/${rel} is empty`);
    });
  }
});
