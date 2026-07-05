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
