/**
 * Integration tests for /api/marp/decks/* endpoints.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMdvServer } from '../src/server.js';

const PORT = 18764;
const ORIGIN = `http://localhost:${PORT}`;

let server;
let tmpRoot;

const SAMPLE = `---
marp: true
---
# A

<!-- a -->

---

# B

<!-- b -->
`;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-api-'));
  await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
  await fs.writeFile(path.join(tmpRoot, 'plain.md'), '# not marp\n', 'utf-8');
  server = createMdvServer({ rootDir: tmpRoot, port: PORT });
  await server.start();
});

after(async () => {
  if (server) await server.stop();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function getDeck(name) {
  const res = await fetch(`${ORIGIN}/api/marp/decks/${encodeURIComponent(name)}`, {
    headers: { Host: `localhost:${PORT}` }
  });
  const data = await res.json();
  return { res, data };
}

async function putNote(name, slideIndex, note, opts = {}) {
  const url = `${ORIGIN}/api/marp/decks/${encodeURIComponent(name)}/slides/${slideIndex}/note`;
  const headers = {
    'Content-Type': 'application/json',
    Origin: opts.origin || ORIGIN,
    Host: `localhost:${PORT}`,
    ...(opts.ifMatch !== undefined ? { 'If-Match': opts.ifMatch } : {}),
    ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
    ...(opts.headers || {})
  };
  if (opts.skipOrigin) delete headers.Origin;
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: opts.body !== undefined ? opts.body : JSON.stringify({ note })
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

describe('GET /api/marp/decks/:path', () => {
  it('returns etag, slideCount, notes, notesMultiplicity for a Marp deck', async () => {
    const { res, data } = await getDeck('deck.md');
    assert.strictEqual(res.status, 200);
    assert.ok(data.ok);
    assert.match(data.etag, /^sha256:[0-9a-f]{64}$/);
    assert.strictEqual(data.slideCount, 2);
    assert.deepStrictEqual(data.notes, ['a', 'b']);
    assert.deepStrictEqual(data.notesMultiplicity, [1, 1]);
    assert.strictEqual(data.lineEnding, '\n');
    assert.strictEqual(data.hasBom, false);
  });

  it('returns NOT_MARP for a non-Marp markdown file', async () => {
    const { res, data } = await getDeck('plain.md');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'NOT_MARP');
  });

  it('returns NOT_FOUND for a missing file', async () => {
    const { res, data } = await getDeck('does-not-exist.md');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.code, 'NOT_FOUND');
  });

  it('rejects path traversal', async () => {
    const { res, data } = await getDeck('../etc/passwd');
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'PATH_INVALID');
  });
});

describe('PUT /api/marp/decks/:path/slides/:n/note', () => {
  it('rewrites the target slide note when ETag matches', async () => {
    // reset content
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const etag = before.data.etag;

    const { res, data } = await putNote('deck.md', 0, 'updated A', { ifMatch: etag });
    assert.strictEqual(res.status, 200);
    assert.ok(data.ok);
    assert.match(data.etag, /^sha256:/);
    assert.notStrictEqual(data.etag, etag);
    assert.strictEqual(data.normalizedNote, 'updated A');

    const after = await getDeck('deck.md');
    assert.deepStrictEqual(after.data.notes, ['updated A', 'b']);
  });

  it('returns 428 when If-Match is missing', async () => {
    const { res, data } = await putNote('deck.md', 0, 'x', {});
    assert.strictEqual(res.status, 428);
    assert.strictEqual(data.code, 'IF_MATCH_REQUIRED');
  });

  it('returns 412 STALE with currentEtag when If-Match is stale', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: 'sha256:' + 'd'.repeat(64)
    });
    assert.strictEqual(res.status, 412);
    assert.strictEqual(data.code, 'STALE');
    assert.match(data.currentEtag, /^sha256:[0-9a-f]{64}$/);
  });

  it('returns 400 INVALID_NOTE when note contains "-->"', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'a --> b', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'INVALID_NOTE');
  });

  it('returns 400 OUT_OF_RANGE for slideIndex >= slideCount', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 99, 'x', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'OUT_OF_RANGE');
  });

  it('returns 403 ORIGIN_REJECTED for cross-origin Origin', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: before.data.etag,
      origin: 'http://evil.com'
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'ORIGIN_REJECTED');
  });

  it('returns 415/400 INVALID_NOTE for non-JSON Content-Type', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: before.data.etag,
      contentType: 'text/plain'
    });
    assert.strictEqual(res.status, 415);
    assert.strictEqual(data.code, 'INVALID_NOTE');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for body > 128KB', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const big = 'x'.repeat(140 * 1024);
    const body = JSON.stringify({ note: big });
    const { res, data } = await putNote('deck.md', 0, undefined, {
      ifMatch: before.data.etag,
      body
    });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(data.code, 'PAYLOAD_TOO_LARGE');
  });

  it('removes the note when body.note is empty', async () => {
    await fs.writeFile(path.join(tmpRoot, 'deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, '', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 200);
    assert.ok(data.ok);
    const after = await getDeck('deck.md');
    assert.deepStrictEqual(after.data.notes, ['', 'b']);
  });

  it('returns 409 MULTI_NOTE_READONLY for slides with multiple notes', async () => {
    const multi = `---\nmarp: true\n---\n# A\n\n<!-- n1 -->\n<!-- n2 -->\n`;
    await fs.writeFile(path.join(tmpRoot, 'multi.md'), multi, 'utf-8');
    const { data: before } = await getDeck('multi.md');
    const { res, data } = await putNote('multi.md', 0, 'merged', { ifMatch: before.etag });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.code, 'MULTI_NOTE_READONLY');
  });
});

describe('OPTIONS preflight', () => {
  it('responds 204 for same-origin preflight', async () => {
    const res = await fetch(`${ORIGIN}/api/marp/decks/deck.md/slides/0/note`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, Host: `localhost:${PORT}` }
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      res.headers.get('access-control-allow-methods'),
      'GET, PUT, OPTIONS'
    );
    // PNA should NOT be allowed
    assert.strictEqual(res.headers.get('access-control-allow-private-network'), null);
  });

  it('rejects cross-origin preflight', async () => {
    const res = await fetch(`${ORIGIN}/api/marp/decks/deck.md/slides/0/note`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.com', Host: `localhost:${PORT}` }
    });
    assert.strictEqual(res.status, 403);
  });
});
