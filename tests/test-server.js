/**
 * Tests for MDV Server
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startTestServer } from './helpers/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version: PKG_VERSION } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

// Moved from the (now-removed) repo-root test-marp.md fixture.
const MARP_FIXTURE = `---
marp: true
---

# Slide 1

This is a test Marp presentation.

---

# Slide 2

Second slide content.
`;

describe('MDV Server', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'README.md': '# Hello\n\nThis is a test README.\n',
        'test-marp.md': MARP_FIXTURE,
      },
    });
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
  });

  describe('API Endpoints', () => {
    it('GET /api/info should return server info', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/info`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(data.rootPath);
      assert.strictEqual(data.version, PKG_VERSION);
    });

    it('GET /api/tree should return file tree', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/tree`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(Array.isArray(data));
    });

    it('GET /api/file should return file content for markdown', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=README.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(data.content);
      assert.ok(data.raw);
      assert.strictEqual(data.fileType, 'markdown');
    });

    it('GET /api/file should return 400 without path', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file`);
      assert.strictEqual(response.status, 400);
    });

    it('GET /api/file should return 404 for non-existent file', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=nonexistent.md`);
      assert.strictEqual(response.status, 404);
    });

    it('GET /api/file should detect Marp files correctly', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=test-marp.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.isMarp, true);
      assert.ok(data.css); // Marp files should have CSS
    });

    it('GET /api/file should NOT detect README.md as Marp', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=README.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.isMarp, false);
    });
  });

  describe('Static Files', () => {
    it('GET / should return index.html', async () => {
      const response = await fetch(`${ctx.baseUrl}/`);
      assert.strictEqual(response.status, 200);

      const contentType = response.headers.get('content-type');
      assert.ok(contentType.includes('text/html'));
    });

    it('GET /static/app.js should return JavaScript', async () => {
      const response = await fetch(`${ctx.baseUrl}/static/app.js`);
      assert.strictEqual(response.status, 200);
    });

    it('GET /static/styles.css should return CSS', async () => {
      const response = await fetch(`${ctx.baseUrl}/static/styles.css`);
      assert.strictEqual(response.status, 200);
    });
  });
});

describe('/api/info pdfStyleDefaults (mdv.config.json -> Style panel flow)', () => {
  it('echoes the pdfStyleDefaults option; empty object when absent', async () => {
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const { createMdvServer } = await import('../src/server.js');

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdv-info-'));
    const server = createMdvServer({
      rootDir: dir,
      port: 0,
      pdfStyleDefaults: { css: 'report.css', pdfOptions: 'pdf-options.json' }
    });
    const { port } = await server.start();
    try {
      const data = await (await fetch(`http://localhost:${port}/api/info`)).json();
      assert.deepStrictEqual(data.pdfStyleDefaults, { css: 'report.css', pdfOptions: 'pdf-options.json' });
    } finally {
      await server.stop();
      await fsp.rm(dir, { recursive: true, force: true });
    }

    const dir2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdv-info2-'));
    const server2 = createMdvServer({ rootDir: dir2, port: 0 });
    const { port: port2 } = await server2.start();
    try {
      const data2 = await (await fetch(`http://localhost:${port2}/api/info`)).json();
      assert.deepStrictEqual(data2.pdfStyleDefaults, {});
    } finally {
      await server2.stop();
      await fsp.rm(dir2, { recursive: true, force: true });
    }
  });
});
