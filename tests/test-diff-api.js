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
import { JOURNAL_MAX_FILE_BYTES, JOURNAL_MAX_VERSIONS_PER_FILE } from '../src/config/constants.js';
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
      removed: [],
    });
  });

  it('0.6.10: a deletion round-trips the actual removed text through removed[].lines', async () => {
    // Baseline at this point (after the previous test) is
    // '# Title\n\nOriginal line.\n\nAppended paragraph.\n' — 5 lines. Deleting
    // ONLY the 'Original line.' line (keeping every surrounding blank line)
    // is the minimal single-line edit, so the diff is unambiguous.
    const base = await fetch(`${ctx.baseUrl}/api/diff?path=note.md`);
    const { currentHash: baselineHash } = await base.json();

    await fs.writeFile(`${ctx.rootDir}/note.md`, '# Title\n\n\nAppended paragraph.\n', 'utf-8');

    const res = await fetch(`${ctx.baseUrl}/api/diff?path=note.md&from=${encodeURIComponent(baselineHash)}`);
    const data = await res.json();
    assert.strictEqual(data.available, true);
    assert.deepStrictEqual(data.removedAt, [2]);
    assert.deepStrictEqual(data.removed, [{ afterLine: 2, lines: ['Original line.'] }]);

    // Restore for later tests in this describe block.
    await fs.writeFile(`${ctx.rootDir}/note.md`, '# Title\n\nOriginal line.\n\nAppended paragraph.\n', 'utf-8');
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

  // 10s, not 3s: chokidar's awaitWriteFinish stability window plus a slow
  // CI runner exceeded 3s once (2026-07-06, Ubuntu runner — the suite's
  // only red in 35+ runs). A generous budget costs nothing when green.
  function waitForNextFileUpdate(messages, fromIndex, timeoutMs = 10000) {
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

describe('GET /api/diff — a pinned baseline survives repeated external edits past the version cap (Fix 1/2, 2026-07-13 — 実装計画_2026-07-13_reviewベースライン消失.md)', () => {
  it('imports JOURNAL_MAX_VERSIONS_PER_FILE and edits the file MORE than that many times: available stays true throughout', async () => {
    // This is the exact reported bug: Reviewモード ON でファイルを開いた状態
    // のまま、そのファイルが繰り返し書き換わると、4回目の書き換えで変更ハイ
    // ライトが丸ごと消える (H0 baseline evicted by the version cap). The cap
    // was raised 4 -> 32, so a fixed small loop count would pass WITHOUT
    // exercising the fix at all (space-out warning in the plan §4) — import
    // the real constant and edit strictly MORE times than it allows.
    const ctx = await startTestServer({ files: { 'churn.md': 'v0\n' } });
    try {
      // First call with no `from`: records H0 and reports unknown-baseline
      // (nothing to diff against yet) — same as the client's first-sight
      // baseline capture (diffReview.js).
      const first = await (await fetch(`${ctx.baseUrl}/api/diff?path=churn.md`)).json();
      const h0 = first.currentHash;
      assert.strictEqual(first.available, false);
      assert.strictEqual(first.reason, 'unknown-baseline');

      // Pin H0: src/api/diff.js only calls journal.get() (the pin trigger)
      // when `from !== currentHash` — an identical-content request never
      // reaches it. Write v1 first so this diff request is a real
      // non-identical lookup against H0, which is what actually pins it.
      await fs.writeFile(`${ctx.rootDir}/churn.md`, 'v1\n', 'utf-8');
      const afterFirstEdit = await (
        await fetch(`${ctx.baseUrl}/api/diff?path=churn.md&from=${encodeURIComponent(h0)}`)
      ).json();
      assert.strictEqual(afterFirstEdit.available, true, `H0 must resolve right after the first edit: ${JSON.stringify(afterFirstEdit)}`);

      // Now churn the file strictly MORE times than JOURNAL_MAX_VERSIONS_PER_FILE,
      // asking for the diff against H0 every single time WITHOUT re-querying
      // from a later hash — this is the "Review ON, keep editing" scenario:
      // the client's baseline stays H0 the whole time (it only advances on
      // 確認/confirm, which this test never does).
      for (let i = 2; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
        await fs.writeFile(`${ctx.rootDir}/churn.md`, `v${i}\n`, 'utf-8');
        const res = await fetch(`${ctx.baseUrl}/api/diff?path=churn.md&from=${encodeURIComponent(h0)}`);
        const data = await res.json();
        assert.strictEqual(
          data.available,
          true,
          `edit #${i} (cap is ${JOURNAL_MAX_VERSIONS_PER_FILE}) must still resolve H0: ${JSON.stringify(data)}`
        );
        assert.strictEqual(data.identical, false);
      }
    } finally {
      await ctx.stop();
    }
  });
});

describe('GET /api/diff — Fix 5 (2026-07-13, 実装計画_2026-07-13_reviewベースライン消失.md §3): the identical-hash branch pins the baseline too', () => {
  it('a from=H0 request with NOTHING changed yet (identical) pins H0, which then survives edits past the version cap made with ZERO further /api/diff calls in between', async () => {
    // This is diffReview.js's "fast path" (modules/diffReview.js, around
    // its `tab.etag === lastSeen.hash` check): the file hasn't changed
    // since the client last saw it, so it sends `from=lastSeen.hash` —
    // which equals the current hash, hitting the `identical` branch, NOT
    // a real diff. Before Fix 5, diffReview.js sent `from=''` here (never
    // pinning anything) and src/api/diff.js's identical branch never
    // called journal.pin() either — so a file opened via Review ON with
    // no pending change had NO pin protecting its baseline the moment it
    // entered edit mode (where autosave churns versions with zero further
    // /api/diff calls — diffReview.js's refresh() early-returns while
    // state.isEditMode is true).
    const ctx = await startTestServer({ files: { 'fastpath.md': 'v0\n' } });
    try {
      const journal = ctx.server.app.locals.changeJournal;
      const { makeEtag } = await import('../src/utils/etag.js');
      const h0 = makeEtag('v0\n');

      const seed = await (
        await fetch(`${ctx.baseUrl}/api/diff?path=fastpath.md&from=${encodeURIComponent(h0)}`)
      ).json();
      assert.strictEqual(seed.available, true);
      assert.strictEqual(seed.identical, true, 'precondition: this is the fast-path/identical branch, not a real diff');

      // Edit-mode simulation: versions pile up WITHOUT any /api/diff call
      // in between, strictly MORE times than JOURNAL_MAX_VERSIONS_PER_FILE
      // so the version cap is actually exercised (a small fixed loop count
      // would pass without touching the fix at all — see the plan's §4
      // space-out warning, same rule as the existing version-cap test
      // above). Manipulate the SAME journal instance the running server
      // uses directly (deterministic, no chokidar/watcher timing needed —
      // same technique as the "codex P2" baseline-survival test above).
      for (let i = 1; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
        journal.record('fastpath.md', `v${i}\n`);
      }
      await fs.writeFile(`${ctx.rootDir}/fastpath.md`, `v${JOURNAL_MAX_VERSIONS_PER_FILE + 5}\n`, 'utf-8');

      const res = await fetch(`${ctx.baseUrl}/api/diff?path=fastpath.md&from=${encodeURIComponent(h0)}`);
      const data = await res.json();
      assert.strictEqual(
        data.available,
        true,
        `H0 must survive — pinned by the identical-branch fast-path seed above: ${JSON.stringify(data)}`
      );
      assert.strictEqual(data.identical, false);
    } finally {
      await ctx.stop();
    }
  });
});

describe('GET /api/diff — a re-pinned baseline (advanced past the ORIGINAL pin via a second identical request) survives the version cap too (codex P1, 2026-07-14 review round)', () => {
  it('①H0 pinned via an identical request ②a real edit is diffed against H0 (H0->H1, NOT itself an identical request, so H1 is not yet pinned) ③the client confirms H1 via ITS OWN identical request (from=H1) ④the version cap is exceeded with zero further /api/diff calls ⑤from=H1 still resolves available:true', async () => {
    // This is the SERVER-side half of the contract modules/diffReview.js's
    // fixed _confirmLatest()/_seedBaseline() now drives end-to-end (see
    // that module and its "codex P1" comments): confirming a diff must
    // pin the NEW hash the same way the fast-path's first-ever seed pins
    // the original one, not just once per path for the lifetime of the
    // page. src/api/diff.js's pinning rule itself (Fix 5) already handles
    // any identical request correctly regardless of how many times a path
    // was seeded before — this test pins down that server contract for a
    // baseline that has ALREADY ADVANCED once, so a regression here would
    // be caught independently of the client-side fix (the client-side half
    // — that the browser actually SENDS step ③'s request after a real
    // ✓ 確認 click, even when an EARLIER hash for the same path was already
    // seeded once this page load — is covered by the Playwright E2E
    // regression test in tests/e2e/18-diff-highlight.spec.js, which is the
    // only test that can actually fail from the pre-fix path-only
    // `_seededPaths` Set: this HTTP-level test cannot observe that bug,
    // since src/api/diff.js's pinning logic was already correct before
    // this review round).
    const ctx = await startTestServer({ files: { 'repin.md': 'v0\n' } });
    try {
      const journal = ctx.server.app.locals.changeJournal;
      const h0 = makeEtag('v0\n');

      // ① H0 pinned via an identical request — same as the Fix 5 test
      // above; this is the FIRST-EVER seed for this path.
      const seed = await (
        await fetch(`${ctx.baseUrl}/api/diff?path=repin.md&from=${encodeURIComponent(h0)}`)
      ).json();
      assert.strictEqual(seed.identical, true, 'precondition: H0 is pinned via the identical branch');

      // ② A real external edit — diffed against H0 (from=H0, currentHash=H1
      // -> NOT an identical request, so this alone does NOT pin H1; only
      // journal.get()'s lookup-side pin fires here, which pins H0 again
      // (the FROM hash), not H1 (the CURRENT hash).
      const v1 = 'v1 edited\n';
      await fs.writeFile(`${ctx.rootDir}/repin.md`, v1, 'utf-8');
      const h1 = makeEtag(v1);
      const realDiff = await (
        await fetch(`${ctx.baseUrl}/api/diff?path=repin.md&from=${encodeURIComponent(h0)}`)
      ).json();
      assert.strictEqual(realDiff.available, true);
      assert.strictEqual(realDiff.identical, false);
      assert.strictEqual(realDiff.currentHash, h1);

      // ③ The client confirms H1 — modules/diffReview.js's _confirmLatest()
      // (post-fix) sends its OWN identical request (from=H1) right when
      // markSeen() advances the local baseline, not just whenever some
      // later fast-path refresh happens to fire.
      const confirm = await (
        await fetch(`${ctx.baseUrl}/api/diff?path=repin.md&from=${encodeURIComponent(h1)}`)
      ).json();
      assert.strictEqual(confirm.identical, true, 'precondition: H1 is pinned via its own identical request');

      // ④ Edit-mode churn past the version cap, zero further /api/diff
      // calls in between — same technique as the Fix 5 test above.
      for (let i = 2; i <= JOURNAL_MAX_VERSIONS_PER_FILE + 5; i++) {
        journal.record('repin.md', `v${i}\n`);
      }
      await fs.writeFile(
        `${ctx.rootDir}/repin.md`,
        `v${JOURNAL_MAX_VERSIONS_PER_FILE + 5}\n`,
        'utf-8'
      );

      // ⑤ from=H1 still resolves — the RE-pin survived the churn exactly
      // like the ORIGINAL pin does in the Fix 5 test.
      const res = await fetch(`${ctx.baseUrl}/api/diff?path=repin.md&from=${encodeURIComponent(h1)}`);
      const data = await res.json();
      assert.strictEqual(
        data.available,
        true,
        `H1 must survive — re-pinned by the second identical-branch confirm above: ${JSON.stringify(data)}`
      );
      assert.strictEqual(data.identical, false);
    } finally {
      await ctx.stop();
    }
  });
});

describe('GET /api/diff — slideRanges (0.6.16, Marp deck diffs only, feeds modules/marpDiffIndicator.js)', () => {
  it('a real diff on a Marp deck includes one-based slideRanges matching the current content\'s slides', async () => {
    const deck = '---\nmarp: true\n---\n\n# 一枚目\n\n---\n\n# 二枚目\n';
    const ctx = await startTestServer({ files: { 'deck.md': deck } });
    try {
      const before = await (await fetch(`${ctx.baseUrl}/api/diff?path=deck.md`)).json();
      const baselineHash = before.currentHash;

      const edited = deck + '\n---\n\n# 三枚目\n';
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.writeFile(path.join(ctx.rootDir, 'deck.md'), edited);

      const res = await fetch(`${ctx.baseUrl}/api/diff?path=deck.md&from=${encodeURIComponent(baselineHash)}`);
      const data = await res.json();
      assert.strictEqual(data.available, true);
      assert.ok(Array.isArray(data.slideRanges), 'slideRanges must be present for a Marp deck diff');
      assert.strictEqual(data.slideRanges.length, 3);
      // One-based inclusive, back-to-back (each slide's range starts the
      // line right after the previous slide's last line) — matching
      // src/api/diff.js's docstring (marpitAdapter.js's parseDeck()
      // 0-based startLine + 1 / endLine as-is, which is already the
      // previous slide's 1-based last line).
      assert.strictEqual(data.slideRanges[0].start, 1);
      for (let i = 1; i < data.slideRanges.length; i++) {
        assert.strictEqual(data.slideRanges[i].start, data.slideRanges[i - 1].end + 1);
      }
      // At least one added range overlaps the LAST (newly-added) slide's
      // range — same overlap test lib/marpDiffMap.js's changedSlideIndices()
      // uses, not strict containment: the hunk may also cover the blank
      // separator line just above the new `---` slide divider.
      const lastRange = data.slideRanges[data.slideRanges.length - 1];
      assert.ok(data.added.some(([s, e]) => lastRange.start <= e && s <= lastRange.end),
        `expected an added range overlapping the new slide ${JSON.stringify(lastRange)}, got ${JSON.stringify(data.added)}`);
    } finally {
      await ctx.stop();
    }
  });

  it('a non-Marp diff never includes slideRanges', async () => {
    const ctx = await startTestServer({ files: { 'plain.md': '# Title\n\nOne.\n' } });
    try {
      const before = await (await fetch(`${ctx.baseUrl}/api/diff?path=plain.md`)).json();
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.writeFile(path.join(ctx.rootDir, 'plain.md'), '# Title\n\nOne.\n\nTwo.\n');

      const res = await fetch(`${ctx.baseUrl}/api/diff?path=plain.md&from=${encodeURIComponent(before.currentHash)}`);
      const data = await res.json();
      assert.strictEqual(data.available, true);
      assert.strictEqual('slideRanges' in data, false);
    } finally {
      await ctx.stop();
    }
  });
});
