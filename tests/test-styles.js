/**
 * Tests for PDF style preset resolution.
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolvePdfOptions, resolveStyle } from '../src/styles/index.js';

describe('PDF Style Resolution', () => {
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-style-test-'));
    await fs.writeFile(path.join(tempDir, 'custom.css'), 'body { color: #222; }');
    await fs.writeFile(
      path.join(tempDir, 'pdf-options.json'),
      JSON.stringify({
        printBackground: true,
        margin: { top: '28mm', right: '20mm', bottom: '22mm', left: '20mm' },
      }),
    );
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should resolve a custom CSS file path directly', async () => {
    const cssPath = path.join(tempDir, 'custom.css');
    const style = await resolveStyle(cssPath);
    const highlightPath = path.join(
      process.cwd(),
      'node_modules',
      'highlight.js',
      'styles',
      'atom-one-dark.css',
    );

    assert.strictEqual(style.stylesheet, cssPath);
    assert.deepStrictEqual(style.stylesheets, [highlightPath, cssPath]);
    assert.strictEqual(style.highlightStyle, 'atom-one-dark');
    assert.strictEqual(Object.hasOwn(style.pdfOptions, 'printBackground'), false);
    assert.strictEqual(style.pdfOptions.format, 'A4');
  });

  it('should not treat report as a built-in preset', async () => {
    await assert.rejects(resolveStyle('report'));
  });

  it('should resolve PDF options from a separate JSON file', async () => {
    const options = await resolvePdfOptions(path.join(tempDir, 'pdf-options.json'));

    assert.strictEqual(options.format, 'A4');
    assert.strictEqual(options.printBackground, true);
    assert.deepStrictEqual(options.margin, {
      top: '28mm',
      right: '20mm',
      bottom: '22mm',
      left: '20mm',
    });
  });
});
