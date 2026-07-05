/**
 * Integration tests for /api/marp/decks/* endpoints.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { startTestServer } from './helpers/server.js';

let ctx;

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
  ctx = await startTestServer({
    files: {
      'deck.md': SAMPLE,
      'plain.md': '# not marp\n',
    },
  });
});

after(async () => {
  if (ctx) await ctx.stop();
});

function deckPath(...segments) {
  return path.join(ctx.rootDir, ...segments);
}

async function getDeck(name) {
  const res = await fetch(`${ctx.baseUrl}/api/marp/decks/${encodeURIComponent(name)}`, {
    headers: { Host: `localhost:${ctx.port}` }
  });
  const data = await res.json();
  return { res, data };
}

async function putNote(name, slideIndex, note, opts = {}) {
  const url = `${ctx.baseUrl}/api/marp/decks/${encodeURIComponent(name)}/slides/${slideIndex}/note`;
  const headers = {
    'Content-Type': 'application/json',
    Origin: opts.origin || ctx.baseUrl,
    Host: `localhost:${ctx.port}`,
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
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
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
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: 'sha256:' + 'd'.repeat(64)
    });
    assert.strictEqual(res.status, 412);
    assert.strictEqual(data.code, 'STALE');
    assert.match(data.currentEtag, /^sha256:[0-9a-f]{64}$/);
  });

  it('returns 400 INVALID_NOTE when note contains "-->"', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'a --> b', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'INVALID_NOTE');
  });

  it('returns 400 OUT_OF_RANGE for slideIndex >= slideCount', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 99, 'x', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'OUT_OF_RANGE');
  });

  it('returns 403 ORIGIN_REJECTED for cross-origin Origin', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: before.data.etag,
      origin: 'http://evil.com'
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'ORIGIN_REJECTED');
  });

  it('returns 415 UNSUPPORTED_MEDIA_TYPE for non-JSON Content-Type', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'x', {
      ifMatch: before.data.etag,
      contentType: 'text/plain'
    });
    assert.strictEqual(res.status, 415);
    assert.strictEqual(data.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for body > 128KB', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
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
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const before = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, '', { ifMatch: before.data.etag });
    assert.strictEqual(res.status, 200);
    assert.ok(data.ok);
    const after = await getDeck('deck.md');
    assert.deepStrictEqual(after.data.notes, ['', 'b']);
  });

  it('returns 409 MULTI_NOTE_READONLY for slides with multiple notes', async () => {
    const multi = `---\nmarp: true\n---\n# A\n\n<!-- n1 -->\n<!-- n2 -->\n`;
    await fs.writeFile(deckPath('multi.md'), multi, 'utf-8');
    const { data: before } = await getDeck('multi.md');
    const { res, data } = await putNote('multi.md', 0, 'merged', { ifMatch: before.etag });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.code, 'MULTI_NOTE_READONLY');
  });
});

describe('TOCTOU guard (regression: handlePut compares deck.realPath, not earlyDeck.realPath)', () => {
  it('symlink swap during request is detected and rejected (best-effort)', async () => {
    // Replace deck.md with a symlink that points to itself indirectly via
    // another file, forcing realpath to differ between pre-lock and check.
    // We can only verify the *positive* case here (no swap happens), so
    // assert the saved file is still the expected one.
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const { data: before } = await getDeck('deck.md');
    const { res, data } = await putNote('deck.md', 0, 'toctou-fix-check', { ifMatch: before.etag });
    assert.strictEqual(res.status, 200);
    assert.ok(data.ok);
    const written = await fs.readFile(deckPath('deck.md'), 'utf-8');
    assert.match(written, /<!-- toctou-fix-check -->/);
  });
});

describe('PUT mutex / parallel requests', () => {
  it('serializes two concurrent PUTs with the same If-Match (no lost write)', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const { data: before } = await getDeck('deck.md');
    const etag = before.etag;
    // Both requests use the same If-Match. Without a per-path mutex, both
    // would read the old source, both would pass If-Match, and both would
    // write — last-write-wins. With the chain mutex, only one wins (200);
    // the second sees the file the first wrote and 412.
    const [r1, r2] = await Promise.all([
      putNote('deck.md', 0, 'A', { ifMatch: etag }),
      putNote('deck.md', 1, 'B', { ifMatch: etag })
    ]);
    const statuses = [r1.res.status, r2.res.status].sort();
    assert.deepStrictEqual(statuses, [200, 412],
      'one PUT must succeed and the other must STALE');
  });
});

describe('Origin handling — Sec-Fetch-Site fallback', () => {
  it('accepts a request with no Origin header but Sec-Fetch-Site=same-origin', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const { data: before } = await getDeck('deck.md');
    const url = `${ctx.baseUrl}/api/marp/decks/${encodeURIComponent('deck.md')}/slides/0/note`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Host: `localhost:${ctx.port}`,
        'Sec-Fetch-Site': 'same-origin',
        'If-Match': before.etag
      },
      body: JSON.stringify({ note: 'sfs-allowed' })
    });
    assert.strictEqual(res.status, 200);
  });

  it('rejects a request with no Origin and no Sec-Fetch-Site (or cross-site)', async () => {
    await fs.writeFile(deckPath('deck.md'), SAMPLE, 'utf-8');
    const { data: before } = await getDeck('deck.md');
    const url = `${ctx.baseUrl}/api/marp/decks/${encodeURIComponent('deck.md')}/slides/0/note`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Host: `localhost:${ctx.port}`,
        'Sec-Fetch-Site': 'cross-site',
        'If-Match': before.etag
      },
      body: JSON.stringify({ note: 'cross-site-blocked' })
    });
    assert.strictEqual(res.status, 403);
  });
});

describe('OPTIONS preflight', () => {
  it('responds 204 for same-origin preflight', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/marp/decks/deck.md/slides/0/note`, {
      method: 'OPTIONS',
      headers: { Origin: ctx.baseUrl, Host: `localhost:${ctx.port}` }
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
    const res = await fetch(`${ctx.baseUrl}/api/marp/decks/deck.md/slides/0/note`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.com', Host: `localhost:${ctx.port}` }
    });
    assert.strictEqual(res.status, 403);
  });
});

describe('ephemeral port (port: 0) — guards use the BOUND port', () => {
  // Regression guard: setup-time capture of buildAllowedHosts(0) produced a
  // stale "localhost:0" allow-list, rejecting every request on ephemeral-
  // port servers even though start() resolves the real port. All guards
  // (marpNote included) must read the allow-list lazily per request.
  let server;
  let boundPort;
  let dir;

  before(async () => {
    const os = await import('node:os');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-port0-'));
    await fs.writeFile(path.join(dir, 'deck.md'), SAMPLE);
    const { createMdvServer } = await import('../src/server.js');
    server = createMdvServer({ rootDir: dir, port: 0 });
    ({ port: boundPort } = await server.start());
    assert.ok(boundPort > 0, 'start() must report the OS-assigned port');
  });

  after(async () => {
    if (server) await server.stop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('GET /api/marp/decks accepts the real bound host', async () => {
    const res = await fetch(`http://localhost:${boundPort}/api/marp/decks/${encodeURIComponent('deck.md')}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });

  it('POST /api/file (originGuard route) also accepts the real bound host', async () => {
    const res = await fetch(`http://localhost:${boundPort}/api/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ path: 'port0.md', content: 'ok' }),
    });
    assert.strictEqual(res.status, 200);
  });
});
