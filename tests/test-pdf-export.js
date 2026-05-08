/**
 * Tests for PDF export route.
 *
 * Regression target: 0.5.8 で plain Markdown 経路が `npx md-to-pdf` を spawn し
 * stdin pipe のまま EOF を待ってハング → 180s SIGTERM していた。
 * 0.5.9 で (1) md-to-pdf を依存追加 (2) execFile に stdio: ['ignore', ...] を渡す
 * ことで根治。このテストは「タイムアウトせず application/pdf が返る」を担保する。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMdvServer } from '../src/server.js';

const port = 19978;
const baseUrl = `http://localhost:${port}`;
const PDF_TEST_TIMEOUT_MS = 60000; // puppeteer 起動を含めて 60s 上限。実測 4-8s

const PLAIN_MD = `# Plain Markdown Test

Hello, world.

- item 1
- item 2
`;

const MARP_MD = `---
marp: true
---

# Marp Test

Hello.

---

## Slide 2
`;

describe('PDF Export API', () => {
  let server;
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-pdf-test-'));
    await fs.writeFile(path.join(tempDir, 'plain.md'), PLAIN_MD);
    await fs.writeFile(path.join(tempDir, 'marp.md'), MARP_MD);

    server = createMdvServer({ rootDir: tempDir, port });
    await server.start();
  });

  after(async () => {
    if (server) await server.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('POST /api/pdf/export returns 400 without filePath', async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/pdf/export returns 403 for path traversal', async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '../../../etc/passwd' }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('POST /api/pdf/export returns 404 for missing file', async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'no-such-file.md' }),
    });
    assert.strictEqual(res.status, 404);
  });

  it('POST /api/pdf/export returns application/pdf for plain markdown', { timeout: PDF_TEST_TIMEOUT_MS }, async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'plain.md' }),
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.match(res.headers.get('content-type') || '', /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'PDF body should not be empty');
    assert.strictEqual(buf.slice(0, 4).toString(), '%PDF', 'body should start with %PDF magic');
  });

  it('POST /api/pdf/export returns application/pdf for Marp file', { timeout: PDF_TEST_TIMEOUT_MS }, async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'marp.md' }),
    });
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.match(res.headers.get('content-type') || '', /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'PDF body should not be empty');
    assert.strictEqual(buf.slice(0, 4).toString(), '%PDF', 'body should start with %PDF magic');
  });
});
