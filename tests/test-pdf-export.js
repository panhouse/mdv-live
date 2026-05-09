/**
 * Tests for PDF export route.
 *
 * Web UI dispatch (in app.js print()):
 * - Marp file → server-side `marp-cli`
 * - Markdown with PDF options JSON applied → server-side `md-to-pdf` (this test path)
 * - Markdown with CSS-only or no Style → browser print dialog (window.print, no API call)
 * - サーバー endpoint 自体は 「JSON 有無に関わらず markdown を渡せば PDF を返す」
 *   実装 (CLI mdv convert / 直接 API call 経路で意味あり)
 *
 * Regression target:
 * - 0.5.8 で markdown 経路が `npx md-to-pdf` で stdin pipe ハングしていた
 *   → 0.5.9 で spawn + stdio:'ignore' に修正、現在は lazy resolution
 * - 0.5.10 marp の hoist 罠 → require.resolve('@marp-team/marp-cli/package.json')
 * - 0.5.11 marp top-level resolve がサーバー起動を壊す → lazy 化 + 503 fallback
 * - 0.5.13 codex round 1 [P1] md-to-pdf workspace 汚染 → temp copy 化
 * - 0.5.13 codex round 1 [P2] symlink で root 外読み取り → realpath 検証
 * - 0.5.13 codex round 2 [P2] response body drain 不足で test runner cancel
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMdvServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = 19978;
const baseUrl = `http://localhost:${port}`;
const PDF_TEST_TIMEOUT_MS = 60000;

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

  // Regression: 0.5.11 で marp 実行ファイルを `node_modules/.bin/marp` 直叩きで
  // 解決していたため fresh install (npm hoisting) で ENOENT。0.5.12 で
  // require.resolve('@marp-team/marp-cli/package.json') から bin スクリプトを
  // 解決する方式に変更
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

  // Regression: 0.5.12 P1 — marp resolution は import 時ではなく request 処理時に
  // 行うこと (optionalDependency 欠如でサーバー全体が起動不能になる事故を防ぐ)
  it('importing src/api/pdf.js does not throw even when marp resolution would fail at call time', async () => {
    const mod = await import('../src/api/pdf.js');
    assert.strictEqual(typeof mod.setupPdfRoutes, 'function');
  });

  // Regression: 0.5.14 codex round 1 [P2] — Style パネルを開いたまま CSS-only
  // で印刷ダイアログを使うと、パネルの input/button が PDF に混入する。
  // @media print で .pdf-style-panel も非表示になっていることを担保
  it('@media print hides .pdf-style-panel to keep it out of browser-printed PDFs', async () => {
    const cssText = await fs.readFile(
      path.join(__dirname, '..', 'src/static/styles.css'),
      'utf-8',
    );
    // 簡易チェック: print block 内のどこかで .pdf-style-panel が hidden にされてる
    const printBlock = cssText.match(/@media print\s*\{[\s\S]*?\n\}/g) || [];
    const hidesStylePanel = printBlock.some((block) =>
      /\.pdf-style-panel[^{}]*\{[^}]*display\s*:\s*none/.test(block) ||
      /\.pdf-style-panel(?=[\s,])[^{}]*?display\s*:\s*none/.test(block) ||
      /\.pdf-style-panel\s*[,{]/.test(block) && /display\s*:\s*none\s*!important/.test(block),
    );
    assert.ok(hidesStylePanel, '@media print should hide .pdf-style-panel');
  });

  // Regression: 0.5.13 codex round 1 [P1] — md-to-pdf CLI はソース隣に
  // foo.pdf を書く挙動。既存 foo.pdf があると上書きされ、その後 temp に
  // rename されるとワークスペースから消える事故。JS API 利用 + writeFile
  // 直書きでワークスペースに一切触れないことを担保
  it('POST /api/pdf/export does not touch the source directory (no foo.pdf created)', { timeout: PDF_TEST_TIMEOUT_MS }, async () => {
    const sentinel = path.join(tempDir, 'plain.pdf');
    const sentinelBefore = await fs.readFile(sentinel).catch(() => null);
    assert.strictEqual(sentinelBefore, null, 'fixture should not pre-exist plain.pdf');

    const res = await fetch(`${baseUrl}/api/pdf/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'plain.md' }),
    });
    assert.strictEqual(res.status, 200);
    // 200 binary response の body を drain しないと undici socket が開いたまま
    // server の download callback が完了せず Node test runner がハングする
    // (codex round 2 P2 の指摘)
    await res.arrayBuffer();

    // ソース dir に plain.pdf が生成されていないこと
    const after = await fs.readFile(sentinel).catch(() => null);
    assert.strictEqual(after, null, 'workspace must not have plain.pdf after export');
  });

  // Regression: 0.5.13 codex round 1 [P2] — markdown 経路は realpath 検証なし
  // で symlink target が root 外を指していても読み取り PDF 化していた
  it('POST /api/pdf/export rejects symlink that points outside rootDir', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-outside-'));
    try {
      const secret = path.join(outside, 'secret.md');
      await fs.writeFile(secret, '# Secret outside root\n');
      const linkPath = path.join(tempDir, 'leak.md');
      try {
        await fs.symlink(secret, linkPath);
      } catch (err) {
        if (err.code === 'EPERM') return; // skip on platforms without symlink perms
        throw err;
      }
      try {
        const res = await fetch(`${baseUrl}/api/pdf/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: 'leak.md' }),
        });
        assert.strictEqual(res.status, 403, `symlink to outside should be denied; got ${res.status}`);
      } finally {
        await fs.unlink(linkPath).catch(() => {});
      }
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('POST /api/pdf/export returns application/pdf for plain markdown (md-to-pdf path)', { timeout: PDF_TEST_TIMEOUT_MS }, async () => {
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
