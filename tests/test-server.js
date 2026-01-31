/**
 * Tests for MDV Server
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMdvServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testRootDir = path.join(__dirname, '..');
const port = 19999;

describe('MDV Server', () => {
  let server;

  before(async () => {
    server = createMdvServer({ rootDir: testRootDir, port });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('API Endpoints', () => {
    it('GET /api/info should return server info', async () => {
      const response = await fetch(`http://localhost:${port}/api/info`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(data.rootPath);
      assert.strictEqual(data.version, '0.3.2');
    });

    it('GET /api/tree should return file tree', async () => {
      const response = await fetch(`http://localhost:${port}/api/tree`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(Array.isArray(data));
    });

    it('GET /api/file should return file content for markdown', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=README.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(data.content);
      assert.ok(data.raw);
      assert.strictEqual(data.fileType, 'markdown');
    });

    it('GET /api/file should return 400 without path', async () => {
      const response = await fetch(`http://localhost:${port}/api/file`);
      assert.strictEqual(response.status, 400);
    });

    it('GET /api/file should return 404 for non-existent file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=nonexistent.md`);
      assert.strictEqual(response.status, 404);
    });

    it('GET /api/file should detect Marp files correctly', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=test-marp.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.isMarp, true);
      assert.ok(data.css); // Marp files should have CSS
    });

    it('GET /api/file should NOT detect README.md as Marp', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=README.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.isMarp, false);
    });
  });

  describe('Static Files', () => {
    it('GET / should return index.html', async () => {
      const response = await fetch(`http://localhost:${port}/`);
      assert.strictEqual(response.status, 200);

      const contentType = response.headers.get('content-type');
      assert.ok(contentType.includes('text/html'));
    });

    it('GET /static/app.js should return JavaScript', async () => {
      const response = await fetch(`http://localhost:${port}/static/app.js`);
      assert.strictEqual(response.status, 200);
    });

    it('GET /static/styles.css should return CSS', async () => {
      const response = await fetch(`http://localhost:${port}/static/styles.css`);
      assert.strictEqual(response.status, 200);
    });
  });
});
