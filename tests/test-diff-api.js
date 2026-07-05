/**
 * src/api/diff.js — GET /api/diff (via a real server through
 * tests/helpers/server.js) + src/services/changeJournal.js wiring through
 * src/watcher.js (app.locals.changeJournal, shared instance).
 *
 * Covers:
 *  - full baseline-capture flow: first call with no `from` records the
 *    current content and reports `unknown-baseline`; a later call with
 *    `from` set to that recorded hash returns the correct hunks
 *  - identical case (`from` === currentHash)
 *  - unknown-baseline for a hash the journal never saw
 *  - src/watcher.js independently records a snapshot on every filesystem
 *    change (BEFORE broadcasting `file_update`, which now carries `etag`
 *    for every text-renderable file, not just Marp), so a diff is
 *    computable purely from watcher-driven history with no prior
 *    GET /api/diff call
 *  - path traversal rejected, missing path, not found, directory
 *  - oversized current file -> `{ available: false, reason: 'too-large' }`
 *    (no currentHash — bails out before reading)
 *  - no Origin/Host guard required (read-only GET)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import WebSocket from 'ws';

import { makeEtag } from '../src/utils/etag.js';
import { JOURNAL_MAX_FILE_BYTES } from '../src/config/constants.js';
import { startTestServer } from './helpers/server.js';

describe('api/diff.js — GET /api/diff (HTTP, baseline-capture flow)', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: { 'note.md': '# Title\n\nOriginal line.\n' },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('first call with no `from` records the current content and reports unknown-baseline', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.available, false);
    assert.strictEqual(data.reason, 'unknown-baseline');
    assert.strictEqual(data.currentHash, makeEtag('# Title\n\nOriginal line.\n'));
  });

  it('a later call with `from` set to the recorded baseline hash returns correct hunks', async () => {
    const before1 = await fetch(`${ctx.baseUrl}/api/diff?path=note.md`);
    const { currentHash: baselineHash } = await before1.json();

    await fs.writeFile(
      `${ctx.rootDir}/note.md`,
      '# Title\n\nOriginal line.\n\nAppended paragraph.\n',
      'utf-8'
    );

    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md&from=${encodeURIComponent(baselineHash)}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.available, true);
    assert.strictEqual(data.identical, false);
    assert.strictEqual(
      data.currentHash,
      makeEtag('# Title\n\nOriginal line.\n\nAppended paragraph.\n')
    );
    // '# Title', '', 'Original line.' (3 lines) -> '# Title', '', 'Original line.', '', 'Appended paragraph.' (5 lines):
    // two new lines appended (a blank separator + the new paragraph).
    assert.deepStrictEqual(data.added, [[4, 5]]);
    assert.deepStrictEqual(data.changed, []);
    assert.deepStrictEqual(data.removedAt, []);
  });

  it('`from` equal to the current hash reports identical with empty hunks', async () => {
    const cur = await fetch(`${ctx.baseUrl}/api/diff?path=note.md`);
    const { currentHash } = await cur.json();

    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md&from=${encodeURIComponent(currentHash)}`);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      available: true,
      identical: true,
      currentHash,
      added: [],
      changed: [],
      removedAt: [],
    });
  });

  it('unknown-baseline for a hash the journal never saw', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md&from=${encodeURIComponent('sha256:deadbeef')}`);
    const data = await res.json();
    assert.strictEqual(data.available, false);
    assert.strictEqual(data.reason, 'unknown-baseline');
    assert.strictEqual(typeof data.currentHash, 'string');
  });

  it('does not require an Origin/Host guard (read-only GET)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md`, {
      headers: { Origin: 'http://evil.com' },
    });
    assert.strictEqual(res.status, 200);
  });
});

describe('api/diff.js — validation / error responses', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'plain.md': 'hello\n',
        'a-dir/inside.md': 'x',
      },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('400s with PATH_REQUIRED when path is missing', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff`);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.code, 'PATH_REQUIRED');
  });

  it('rejects path traversal with 403 ACCESS_DENIED', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=${encodeURIComponent('../../etc/passwd')}`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.code, 'ACCESS_DENIED');
  });

  it('404s with NOT_FOUND for a nonexistent file', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=${encodeURIComponent('nope.md')}`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.code, 'NOT_FOUND');
  });

  it('400s with IS_DIRECTORY when path is a directory', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=${encodeURIComponent('a-dir')}`);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'IS_DIRECTORY');
  });
});

describe('api/diff.js — oversized current file', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({ files: {} });
    await fs.writeFile(
      `${ctx.rootDir}/huge.md`,
      'x'.repeat(JOURNAL_MAX_FILE_BYTES + 100),
      'utf-8'
    );
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('returns { available: false, reason: "too-large" } without a currentHash', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/diff?path=huge.md`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, { available: false, reason: 'too-large' });
  });
});

describe('api/diff.js — DIFF_MAX_LINES cap surfaces through the HTTP layer', () => {
  let ctx;
  const LINES = 21000; // > DIFF_MAX_LINES (20000), but total bytes stay well under JOURNAL_MAX_FILE_BYTES

  function makeContent(marker) {
    const lines = Array.from({ length: LINES }, (_, i) => `l${i}`);
    lines[0] = marker;
    return lines.join('\n') + '\n';
  }

  before(async () => {
    ctx = await startTestServer({ files: { 'giant.md': makeContent('v1') } });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('baseline + current are both readable but too many lines to diff -> too-large (with currentHash)', async () => {
    const first = await fetch(`${ctx.baseUrl}/api/diff?path=giant.md`);
    const { currentHash: baselineHash } = await first.json();

    await fs.writeFile(`${ctx.rootDir}/giant.md`, makeContent('v2'), 'utf-8');

    const res = await fetch(`${ctx.baseUrl}/api/diff?path=giant.md&from=${encodeURIComponent(baselineHash)}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.available, false);
    assert.strictEqual(data.reason, 'too-large');
    assert.strictEqual(typeof data.currentHash, 'string');
  });
});

describe('watcher.js — records a change-journal snapshot on every filesystem change, independent of any /api/diff call', () => {
  let ctx;
  let ws;

  function openWatchingClient(path) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(ctx.baseUrl.replace(/^http/, 'ws'));
      const messages = [];
      socket.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          /* ignore non-JSON frames */
        }
      });
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'watch', path }));
        resolve({ socket, messages });
      });
      socket.on('error', reject);
    });
  }

  function waitForNextFileUpdate(messages, fromIndex, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        const hit = messages.slice(fromIndex).find((m) => m.type === 'file_update');
        if (hit) return resolve(hit);
        if (Date.now() > deadline) return reject(new Error('timed out waiting for file_update'));
        setTimeout(check, 20);
      };
      check();
    });
  }

  before(async () => {
    ctx = await startTestServer({
      files: { 'live.md': 'line1\nline2\n' },
    });
  });

  after(async () => {
    if (ws) ws.close();
    if (ctx) await ctx.stop();
  });

  it('file_update carries a content-hash etag for a plain (non-Marp) markdown file', async () => {
    const { socket, messages } = await openWatchingClient('live.md');
    ws = socket;

    const v2 = 'line1\nCHANGED\n';
    await fs.writeFile(`${ctx.rootDir}/live.md`, v2, 'utf-8');
    const update1 = await waitForNextFileUpdate(messages, 0);

    assert.strictEqual(update1.path, 'live.md');
    assert.strictEqual(update1.etag, makeEtag(v2), 'etag is the content hash of the raw source');
    assert.strictEqual(update1.raw, v2);

    // A second external change, so we can diff v2 (recorded by the watcher
    // itself, via the file_update we just observed) against v3 — proving
    // the journal was seeded by watcher.js alone, with no GET /api/diff
    // call ever having captured v2 as a baseline.
    const v3 = 'line1\nCHANGED\nline3\n';
    await fs.writeFile(`${ctx.rootDir}/live.md`, v3, 'utf-8');
    await waitForNextFileUpdate(messages, messages.length);

    const res = await fetch(`${ctx.baseUrl}/api/diff?path=live.md&from=${encodeURIComponent(update1.etag)}`);
    const data = await res.json();
    assert.strictEqual(data.available, true);
    assert.strictEqual(data.identical, false);
    assert.strictEqual(data.currentHash, makeEtag(v3));
    assert.deepStrictEqual(data.added, [[3, 3]]);
    assert.deepStrictEqual(data.changed, []);
    assert.deepStrictEqual(data.removedAt, []);
  });
});

describe('GET /api/diff — baseline lookup happens before recording (codex P2)', () => {
  it('a baseline at the version-cap edge survives the request that would evict it', async () => {
    const ctx = await startTestServer({ files: { 'cap.md': 'v-current\n' } });
    try {
      const journal = ctx.server.app.locals.changeJournal;
      // Fill the per-file cap (4) with synthetic versions; v1 is oldest.
      const h1 = journal.record('cap.md', 'v1\n');
      journal.record('cap.md', 'v2\n');
      journal.record('cap.md', 'v3\n');
      journal.record('cap.md', 'v4\n');
      // Disk content ('v-current') is a NEW 5th version. Recording it
      // before looking up h1 would evict h1 -> unknown-baseline.
      const res = await fetch(`${ctx.baseUrl}/api/diff?path=cap.md&from=${encodeURIComponent(h1)}`);
      const data = await res.json();
      assert.strictEqual(data.available, true, `expected a real diff, got ${JSON.stringify(data)}`);
      assert.strictEqual(data.identical, false);
    } finally {
      await ctx.stop();
    }
  });
});

describe('GET /api/diff — identical response still seeds the journal (codex round-4)', () => {
  it('a baseline confirmed via the identical path is diffable after a later edit', async () => {
    const ctx = await startTestServer({ files: { 'seed.md': 'v1\n' } });
    try {
      const journal = ctx.server.app.locals.changeJournal;
      // Client gets the current hash from elsewhere (e.g. /api/file etag)
      // — compute it directly here without a prior /api/diff call.
      const { makeEtag } = await import('../src/utils/etag.js');
      const h1 = makeEtag('v1\n');

      // First-ever diff call uses from=<current> -> identical early return.
      const first = await (await fetch(`${ctx.baseUrl}/api/diff?path=seed.md&from=${encodeURIComponent(h1)}`)).json();
      assert.strictEqual(first.identical, true);

      // Simulate a later edit WITHOUT the watcher (write straight into the
      // journal-visible file and bypass the debounce by asking diff.js to
      // read disk directly).
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.writeFile(path.join(ctx.rootDir, 'seed.md'), 'v1\nv2 added\n');
      // Ensure the watcher did NOT record between write and request: even
      // if it did, the assertion below only gets easier; the regression
      // case is when it did not.
      journal; // (documentational)

      const second = await (await fetch(`${ctx.baseUrl}/api/diff?path=seed.md&from=${encodeURIComponent(h1)}`)).json();
      assert.strictEqual(second.available, true, `identical path must have seeded v1: ${JSON.stringify(second)}`);
      assert.deepStrictEqual(second.added, [[2, 2]]);
    } finally {
      await ctx.stop();
    }
  });
});
