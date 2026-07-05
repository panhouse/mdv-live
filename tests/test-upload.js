/**
 * Tests for the upload API route (POST /api/upload).
 *
 * Regression targets (2026-07 refactor):
 * - SECURITY (P1-adjacent): the multer `destination()` callback used to
 *   validate the client-supplied `path` field with the weak sync
 *   validatePath() only, so a symlinked directory pointing outside rootDir
 *   could be used to land an upload outside the served tree. It now uses
 *   validatePathReal() (realpath-aware), matching the rigor tree.js/pdf.js
 *   already apply.
 * - CSRF (P1): POST /api/upload had no Origin/Host guard, so a form POST
 *   from a foreign page could upload arbitrary files. It now goes through
 *   the same originGuard middleware as /api/shutdown and the marpNote
 *   mutation routes (src/server.js's app.locals.allowedHosts contract).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { UPLOAD_FILE_SIZE_LIMIT } from '../src/config/constants.js';
import { startTestServer } from './helpers/server.js';

describe('POST /api/upload', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({ files: {} });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  function sameOriginHeaders(extra = {}) {
    return { Origin: ctx.baseUrl, Host: `localhost:${ctx.port}`, ...extra };
  }

  it('happy path: multipart upload writes the file under rootDir', async () => {
    const form = new FormData();
    form.append('path', '');
    form.append('files', new Blob(['hello upload'], { type: 'text/plain' }), 'greeting.txt');

    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: form,
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.files.length, 1);
    assert.strictEqual(data.files[0].name, 'greeting.txt');

    const written = await fs.readFile(path.join(ctx.rootDir, 'greeting.txt'), 'utf-8');
    assert.strictEqual(written, 'hello upload');
  });

  it('happy path: uploading with a "path" field creates the subdirectory and writes there', async () => {
    const form = new FormData();
    form.append('path', 'uploads/sub');
    form.append('files', new Blob(['nested content'], { type: 'text/plain' }), 'nested.txt');

    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: form,
    });
    assert.strictEqual(res.status, 200);

    const written = await fs.readFile(path.join(ctx.rootDir, 'uploads/sub/nested.txt'), 'utf-8');
    assert.strictEqual(written, 'nested content');
  });

  it('returns 400 NO_FILES_UPLOADED when no files are attached', async () => {
    const form = new FormData();
    form.append('path', '');

    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: form,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'NO_FILES_UPLOADED');
  });

  it('rejects a path-escape attempt in the "path" field (403 ACCESS_DENIED)', async () => {
    const form = new FormData();
    form.append('path', '../../etc');
    form.append('files', new Blob(['x'], { type: 'text/plain' }), 'passwd.txt');

    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: form,
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'ACCESS_DENIED');
  });

  it('rejects a "path" that resolves outside rootDir via a symlink (403 ACCESS_DENIED)', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-upload-outside-'));
    const linkPath = path.join(ctx.rootDir, 'escape-link');
    try {
      await fs.symlink(outside, linkPath);
    } catch (err) {
      if (err.code === 'EPERM') return; // skip on platforms without symlink perms
      throw err;
    }
    try {
      const form = new FormData();
      form.append('path', 'escape-link');
      form.append('files', new Blob(['x'], { type: 'text/plain' }), 'leak.txt');

      const res = await fetch(`${ctx.baseUrl}/api/upload`, {
        method: 'POST',
        headers: sameOriginHeaders(),
        body: form,
      });
      assert.strictEqual(res.status, 403, `symlink escape should be denied; got ${res.status}`);

      const leaked = await fs.readFile(path.join(outside, 'leak.txt')).catch(() => null);
      assert.strictEqual(leaked, null, 'file must not be written outside rootDir');
    } finally {
      await fs.unlink(linkPath).catch(() => {});
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a cross-origin request (403 ORIGIN_REJECTED) before touching multer', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: { Origin: 'http://evil.com', Host: `localhost:${ctx.port}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'ORIGIN_REJECTED');
  });

  it('rejects a request with no Origin and no Sec-Fetch-Site (403 ORIGIN_REJECTED)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: { Host: `localhost:${ctx.port}` },
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'ORIGIN_REJECTED');
  });

  // Transfers ~UPLOAD_FILE_SIZE_LIMIT (100MB) over loopback to exercise the
  // real configured cap end-to-end; multer's busboy-level 'limit' handling
  // drains the request fully before responding (no ECONNRESET) and removes
  // the truncated partial file itself (see node_modules/multer/lib/
  // make-middleware.js abortWithError -> storage._removeFile).
  it('rejects an oversize file (413 PAYLOAD_TOO_LARGE)', { timeout: 30000 }, async () => {
    const big = Buffer.alloc(UPLOAD_FILE_SIZE_LIMIT + 1024, 0x61); // 1KB over the cap
    const form = new FormData();
    form.append('path', '');
    form.append('files', new Blob([big], { type: 'application/octet-stream' }), 'huge.bin');

    const res = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: form,
    });
    assert.strictEqual(res.status, 413, `expected 413, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.code, 'PAYLOAD_TOO_LARGE');

    const leaked = await fs.readFile(path.join(ctx.rootDir, 'huge.bin')).catch(() => null);
    assert.strictEqual(leaked, null, 'oversize file must not remain on disk');
  });
});
