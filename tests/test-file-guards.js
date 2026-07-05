/**
 * src/api/file.js — Origin/Host guard coverage for the 4 mutating routes
 * (POST /api/file, DELETE /api/file, POST /api/mkdir, POST /api/move) +
 * a concurrency proof that two parallel POST /api/file saves to the same
 * path serialize (via concurrency/pathLock.js + utils/atomicWrite.js)
 * without corrupting the file.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startTestServer } from './helpers/server.js';

describe('file.js mutating routes — Origin/Host guard', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({ files: {} });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  function tempPath(...segments) {
    return path.join(ctx.rootDir, ...segments);
  }

  const routes = [
    {
      name: 'POST /api/file',
      request: (headers) => fetch(`${ctx.baseUrl}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ path: 'guard-save.md', content: 'x' }),
      }),
    },
    {
      name: 'DELETE /api/file',
      request: async (headers) => {
        // Ensure the target exists before every attempt (including rejected
        // ones, which never reach the handler and so never delete it).
        await fs.writeFile(tempPath('guard-delete.md'), 'x');
        return fetch(`${ctx.baseUrl}/api/file?path=guard-delete.md`, {
          method: 'DELETE',
          headers,
        });
      },
    },
    {
      name: 'POST /api/mkdir',
      request: (headers) => fetch(`${ctx.baseUrl}/api/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ path: 'guard-dir' }),
      }),
    },
    {
      name: 'POST /api/move',
      request: async (headers) => {
        await fs.writeFile(tempPath('guard-move-src.md'), 'x');
        return fetch(`${ctx.baseUrl}/api/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ source: 'guard-move-src.md', destination: 'guard-move-dst.md' }),
        });
      },
    },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      it('allows a same-origin request (Origin header matching this server)', async () => {
        const res = await route.request({ Origin: ctx.baseUrl });
        assert.strictEqual(res.status, 200);
      });

      it('allows a request with no Origin header when Sec-Fetch-Site is same-origin', async () => {
        const res = await route.request({ 'Sec-Fetch-Site': 'same-origin' });
        assert.strictEqual(res.status, 200);
      });

      it('rejects a cross-origin Origin with 403 ORIGIN_REJECTED', async () => {
        const res = await route.request({ Origin: 'http://evil.com' });
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.code, 'ORIGIN_REJECTED');
      });
    });
  }
});

describe('POST /api/file — concurrent saves to the same path', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({ files: { 'concurrent.md': 'initial' } });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('serializes writes so the final content is exactly one payload, never a mix or truncated', async () => {
    const target = 'concurrent.md';
    const targetPath = path.join(ctx.rootDir, target);

    const payloadA = 'A'.repeat(50000);
    const payloadB = 'B'.repeat(50000);

    function save(content) {
      return fetch(`${ctx.baseUrl}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ path: target, content }),
      });
    }

    const [resA, resB] = await Promise.all([save(payloadA), save(payloadB)]);
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);

    const finalContent = await fs.readFile(targetPath, 'utf-8');
    assert.ok(
      finalContent === payloadA || finalContent === payloadB,
      'final content must be exactly one of the two payloads in full — never a mix, never truncated'
    );
    assert.ok(
      finalContent.length === payloadA.length,
      `final content length ${finalContent.length} must equal a full payload (${payloadA.length})`
    );
  });
});
