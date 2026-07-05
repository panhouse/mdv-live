/**
 * Guards against vendor drift: scripts/sync-vendor.js copies installed
 * package versions into src/static/vendor/, but nothing previously
 * recorded/checked which version was actually synced. If a devDependency
 * (mermaid, html2pdf.js, @highlightjs/cdn-assets) is bumped in package.json
 * without re-running `node scripts/sync-vendor.js`, the vendored file
 * silently goes stale. This test fails loudly in that case by comparing
 * src/static/vendor/versions.json (written by sync-vendor.js) against the
 * version actually installed in node_modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const versionsPath = path.join(repoRoot, 'src', 'static', 'vendor', 'versions.json');

function readInstalledVersion(pkgName) {
  const pkgJsonPath = path.join(repoRoot, 'node_modules', pkgName, 'package.json');
  return JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version;
}

describe('src/static/vendor/versions.json', () => {
  it('exists and is a non-empty JSON object', () => {
    const raw = readFileSync(versionsPath, 'utf-8');
    const versions = JSON.parse(raw);
    assert.ok(versions && typeof versions === 'object' && !Array.isArray(versions));
    assert.ok(Object.keys(versions).length > 0, 'versions.json should record at least one package');
  });

  it('records mermaid, html2pdf.js, and @highlightjs/cdn-assets', () => {
    const versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));
    for (const pkgName of ['mermaid', 'html2pdf.js', '@highlightjs/cdn-assets']) {
      assert.ok(
        Object.hasOwn(versions, pkgName),
        `versions.json should record a version for ${pkgName}`
      );
    }
  });

  it('each recorded version matches the currently installed devDependency version', () => {
    const versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));
    for (const [pkgName, recordedVersion] of Object.entries(versions)) {
      const installedVersion = readInstalledVersion(pkgName);
      assert.strictEqual(
        recordedVersion,
        installedVersion,
        `${pkgName}: src/static/vendor/versions.json says ${recordedVersion} but node_modules has ` +
        `${installedVersion} — run \`node scripts/sync-vendor.js\` to re-sync`
      );
    }
  });
});
