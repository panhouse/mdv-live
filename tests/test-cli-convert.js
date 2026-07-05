/**
 * Tests for src/cli/convert.js — `mdv convert` orchestration.
 *
 * Extracted from bin/mdv.js (Phase 4): isMarp routing now imports the
 * canonical isMarp (src/rendering/markdown.js, re-exported from
 * marpitAdapter.js) instead of a re-implemented regex (P1 SSOT fix).
 *
 * These tests mock the PDF-generation seams (exportMarpPdf/
 * exportMarkdownPdf) via dependency injection — they must NOT invoke the
 * real marp-cli/md-to-pdf binaries.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { computeDefaultOutputPath, convertToPdf } from '../src/cli/convert.js';

const tmpDirs = [];

async function makeTmpFile(name, content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-cli-convert-test-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

after(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('cli/convert: computeDefaultOutputPath', () => {
  it('replaces a .md extension with .pdf', () => {
    assert.strictEqual(computeDefaultOutputPath('/a/b/doc.md'), '/a/b/doc.pdf');
  });

  it('replaces a .markdown extension with .pdf', () => {
    assert.strictEqual(computeDefaultOutputPath('/a/b/doc.markdown'), '/a/b/doc.pdf');
  });

  it('is case-insensitive on the extension', () => {
    assert.strictEqual(computeDefaultOutputPath('/a/b/DOC.MD'), '/a/b/DOC.pdf');
  });
});

describe('cli/convert: convertToPdf — isMarp routing + default output path', () => {
  it('routes Marp frontmatter files to exportMarpPdf, not exportMarkdownPdf', async () => {
    const inputPath = await makeTmpFile('slide.md', '---\nmarp: true\n---\n\n# Slide\n');

    let marpCall = null;
    let markdownCall = null;
    const code = await convertToPdf(inputPath, undefined, undefined, undefined, {
      exportMarpPdf: async (input, output) => { marpCall = { input, output }; },
      exportMarkdownPdf: async () => { markdownCall = true; },
    });

    assert.strictEqual(code, 0);
    assert.ok(marpCall, 'expected exportMarpPdf to be called');
    assert.strictEqual(markdownCall, null);
    assert.strictEqual(marpCall.input, path.resolve(inputPath));
    assert.strictEqual(marpCall.output, computeDefaultOutputPath(path.resolve(inputPath)));
  });

  it('routes plain markdown files to exportMarkdownPdf, not exportMarpPdf', async () => {
    const inputPath = await makeTmpFile('doc.md', '# Just a heading\n\nSome text.\n');

    let marpCall = null;
    let markdownCall = null;
    const code = await convertToPdf(inputPath, undefined, undefined, undefined, {
      exportMarpPdf: async () => { marpCall = true; },
      exportMarkdownPdf: async (input, output) => { markdownCall = { input, output }; },
    });

    assert.strictEqual(code, 0);
    assert.ok(markdownCall, 'expected exportMarkdownPdf to be called');
    assert.strictEqual(marpCall, null);
    assert.strictEqual(markdownCall.output, computeDefaultOutputPath(path.resolve(inputPath)));
  });

  it('honors an explicit output path over the computed default', async () => {
    const inputPath = await makeTmpFile('doc2.md', '# Heading\n');
    const explicitOutput = path.join(path.dirname(inputPath), 'custom-name.pdf');

    let markdownCall = null;
    const code = await convertToPdf(inputPath, explicitOutput, undefined, undefined, {
      exportMarkdownPdf: async (input, output) => { markdownCall = { input, output }; },
    });

    assert.strictEqual(code, 0);
    assert.strictEqual(markdownCall.output, path.resolve(explicitOutput));
  });

  it('returns exit code 1 (never throws) when the input file does not exist', async () => {
    const code = await convertToPdf('/does/not/exist.md', undefined, undefined, undefined, {});
    assert.strictEqual(code, 1);
  });

  it('returns exit code 1 for a non-markdown extension', async () => {
    const inputPath = await makeTmpFile('notes.txt', 'plain text');
    const code = await convertToPdf(inputPath, undefined, undefined, undefined, {});
    assert.strictEqual(code, 1);
  });

  it('returns exit code 1 when the PDF generation seam throws (never invoking process.exit)', async () => {
    const inputPath = await makeTmpFile('doc3.md', '# Heading\n');
    const code = await convertToPdf(inputPath, undefined, undefined, undefined, {
      exportMarkdownPdf: async () => { throw new Error('boom'); },
    });
    assert.strictEqual(code, 1);
  });
});
