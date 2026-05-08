/**
 * Tests for PDF export route.
 *
 * 仕様: Web UI の "Export to PDF" ボタンは Marp ファイルだけがこの経路を使う。
 * 通常 Markdown はクライアント側で window.print() を呼び OS 印刷ダイアログを
 * 出す。サーバーは Marp 以外を 415 で拒否する。
 *
 * Regression target:
 * - 0.5.8 で markdown 経路が `npx md-to-pdf` を spawn し stdin pipe のまま
 *   EOF を待ってハングしていた → 0.5.10 で markdown は server PDF 経路を
 *   使わない設計に統一し、サーバー側は Marp 専用に簡素化
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMdvServer } from '../src/server.js';

const port = 19978;
const baseUrl = `http://localhost:${port}`;
const PDF_TEST_TIMEOUT_MS = 60000;

const PLAIN_MD = `# Plain Markdown Test

Hello, world.
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
    await fs.mkdir(path.join(tempDir, 'subdir'));

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

  // Regression: codex round 3 P2 — fs.readFile が try 外で directory 指定時に
  // unhandled rejection になり 500 が返らず Express デフォルトエラーに陥っていた
  it('POST /api/pdf/export returns 404 (controlled JSON) for directory path', async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'subdir' }),
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /not found/i);
  });

  it('POST /api/pdf/export returns 415 for non-Marp Markdown', async () => {
    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'plain.md' }),
    });
    assert.strictEqual(res.status, 415, `expected 415, got ${res.status}`);
    const data = await res.json();
    assert.match(data.error, /Marp/i);
  });

  // Regression: 0.5.10 で marp 実行ファイルを `node_modules/.bin/marp` 直叩きで
  // 解決していたため fresh install (npm hoisting) で ENOENT。0.5.11 で
  // require.resolve('@marp-team/marp-cli/package.json') から bin スクリプトを
  // 解決する方式に変更。ここでは bin entry のファイル実体が存在するかだけ確認
  it('marp-cli bin entry resolves to an existing file', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('@marp-team/marp-cli/package.json');
    const pkg = require('@marp-team/marp-cli/package.json');
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.marp;
    assert.ok(binRel, 'marp-cli should declare a marp bin entry');
    const binAbs = path.join(path.dirname(pkgPath), binRel);
    const stat = await fs.stat(binAbs);
    assert.ok(stat.isFile(), `bin file should exist: ${binAbs}`);
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
