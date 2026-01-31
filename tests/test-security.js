/**
 * Security Tests - Path traversal prevention
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createMdvServer } from '../src/server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testRootDir = path.join(__dirname, '..');

describe('Security', () => {
  let server;
  const port = 19998;

  before(async () => {
    server = createMdvServer({ rootDir: testRootDir, port });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Path Traversal Prevention', () => {
    it('should block ../ path traversal', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=../secret.txt`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block ../../ path traversal', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=../../etc/passwd`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block URL-encoded path traversal', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=..%2F..%2Fetc%2Fpasswd`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block absolute paths', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=/etc/passwd`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block double-encoded path traversal', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=..%252F..%252Fetc%252Fpasswd`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block Windows-style absolute paths', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=C:\\Windows\\System32\\config\\sam`);
      assert.ok([403, 404].includes(response.status));
    });

    it('should block null byte injection', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=test.md%00.txt`);
      assert.ok([400, 403, 404].includes(response.status));
    });

    it('should block path traversal in POST /api/file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../tmp/evil.txt', content: 'evil' })
      });
      assert.ok([403, 404].includes(response.status));
    });

    it('should block path traversal in DELETE /api/file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=../../../tmp/evil.txt`, {
        method: 'DELETE'
      });
      assert.ok([403, 404].includes(response.status));
    });

    it('should block path traversal in POST /api/mkdir', async () => {
      const response = await fetch(`http://localhost:${port}/api/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../tmp/evil_dir' })
      });
      assert.ok([403, 404].includes(response.status));
    });

    it('should allow valid nested paths', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=src/server.js`);
      assert.strictEqual(response.status, 200);
    });
  });

  describe('API Security', () => {
    it('should require path parameter for file operations', async () => {
      const response = await fetch(`http://localhost:${port}/api/file`);
      assert.strictEqual(response.status, 400);
    });

    it('should return 404 for non-existent files', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=nonexistent-file-12345.md`);
      assert.strictEqual(response.status, 404);
    });
  });
});
