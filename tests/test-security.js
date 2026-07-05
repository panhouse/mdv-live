/**
 * Security Tests - Path traversal prevention
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { startTestServer } from './helpers/server.js';

/**
 * Assert that the response status indicates the request was blocked.
 * Security endpoints may return 403 (forbidden) or 404 (not found).
 */
function assertBlocked(response, message) {
  const blockedStatuses = [403, 404];
  assert.ok(
    blockedStatuses.includes(response.status),
    `${message}: expected 403 or 404, got ${response.status}`
  );
}

/**
 * Assert that the response status indicates the request was blocked,
 * including 400 for malformed requests (e.g., null byte injection).
 */
function assertBlockedOrBadRequest(response, message) {
  const blockedStatuses = [400, 403, 404];
  assert.ok(
    blockedStatuses.includes(response.status),
    `${message}: expected 400, 403, or 404, got ${response.status}`
  );
}

describe('Security', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        // Nested file used to prove valid nested paths still resolve.
        'nested/valid.md': '# Nested valid file\n',
      },
    });
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
  });

  describe('Path Traversal Prevention', () => {
    it('should block ../ path traversal', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=../secret.txt`);
      assertBlocked(response, '../ traversal');
    });

    it('should block ../../ path traversal', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=../../etc/passwd`);
      assertBlocked(response, '../../ traversal');
    });

    it('should block URL-encoded path traversal', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=..%2F..%2Fetc%2Fpasswd`);
      assertBlocked(response, 'URL-encoded traversal');
    });

    it('should block absolute paths', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=/etc/passwd`);
      assertBlocked(response, 'absolute path');
    });

    it('should block double-encoded path traversal', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=..%252F..%252Fetc%252Fpasswd`);
      assertBlocked(response, 'double-encoded traversal');
    });

    it('should block Windows-style absolute paths', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=C:\\Windows\\System32\\config\\sam`);
      assertBlocked(response, 'Windows absolute path');
    });

    it('should block null byte injection', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=test.md%00.txt`);
      assertBlockedOrBadRequest(response, 'null byte injection');
    });

    it('should block path traversal in POST /api/file', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../tmp/evil.txt', content: 'evil' })
      });
      assertBlocked(response, 'POST path traversal');
    });

    it('should block path traversal in DELETE /api/file', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=../../../tmp/evil.txt`, {
        method: 'DELETE'
      });
      assertBlocked(response, 'DELETE path traversal');
    });

    it('should block path traversal in POST /api/mkdir', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../../tmp/evil_dir' })
      });
      assertBlocked(response, 'mkdir path traversal');
    });

    it('should allow valid nested paths', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=nested/valid.md`);
      assert.strictEqual(response.status, 200);
    });
  });

  describe('API Security', () => {
    it('should require path parameter for file operations', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file`);
      assert.strictEqual(response.status, 400);
    });

    it('should return 404 for non-existent files', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=nonexistent-file-12345.md`);
      assert.strictEqual(response.status, 404);
    });
  });
});
