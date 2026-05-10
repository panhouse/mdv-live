/**
 * Tests for src/static/lib/saveQueue.js — pure JS, no DOM required.
 *
 * The browser-side library exposes itself on `globalThis.MDVSaveQueue`. We
 * load it into an isolated VM context so we can exercise it under Node.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(
  path.join(here, '..', 'src', 'static', 'lib', 'saveQueue.js'),
  'utf-8'
);

function loadQueue() {
  const sandbox = vm.createContext({ console });
  vm.runInContext(code, sandbox);
  return sandbox.MDVSaveQueue;
}

describe('SaveQueue — coalesce + serialization', () => {
  it('coalesces edits to the same slide that arrive while a save is in flight', async () => {
    // Use a slow saveFn so we can observe coalesce of edits arriving while
    // the first save is in flight.
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (path, slideIndex, note) => {
        calls.push(note);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    q.enqueue('a.md', 0, 'first', null);     // starts immediately
    // After microtask boundary, the in-flight save has begun; further edits
    // for the same slide should coalesce into a single follow-up save.
    await new Promise((r) => setImmediate(r));
    q.enqueue('a.md', 0, 'second', null);
    q.enqueue('a.md', 0, 'third', null);
    q.enqueue('a.md', 0, 'fourth', null);
    await new Promise((r) => setTimeout(r, 80));
    // First save 'first' was already running. The 3 subsequent edits
    // coalesce into one follow-up save with the latest value 'fourth'.
    assert.deepStrictEqual(calls, ['first', 'fourth']);
  });

  it('saves different slides in insertion order, serially', async () => {
    const order = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (p, idx) => {
        order.push(['start', idx]);
        await new Promise((r) => setTimeout(r, 10));
        order.push(['end', idx]);
      }
    });
    q.enqueue('a.md', 0, 'A', null);
    q.enqueue('a.md', 1, 'B', null);
    q.enqueue('a.md', 2, 'C', null);
    await new Promise((r) => setTimeout(r, 80));
    // Each slide's [start, end] must be contiguous (no overlap).
    const flatIdx = order.map((x) => x[1]);
    assert.deepStrictEqual(flatIdx, [0, 0, 1, 1, 2, 2]);
  });

  it('different paths drain independently', async () => {
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (p, idx) => {
        calls.push(p);
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    q.enqueue('a.md', 0, 'x', null);
    q.enqueue('b.md', 0, 'y', null);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(calls.sort(), ['a.md', 'b.md']);
  });

  it('dropPath removes still-pending edits for that path', async () => {
    // dropPath cancels work that has not yet been pulled out of the queue.
    // An in-flight saveFn invocation already runs to completion (we don't
    // forcibly abort it). Use a slow saveFn so we can observe pending
    // entries being dropped before they're processed.
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (p, idx) => {
        calls.push([p, idx]);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    q.enqueue('a.md', 0, 'first-runs', null);  // pulled and running
    q.enqueue('a.md', 1, 'still-pending', null); // sits in queue behind #0
    q.dropPath('a.md');                          // cancels #1
    q.enqueue('b.md', 0, 'kept', null);
    await new Promise((r) => setTimeout(r, 80));
    // #0 already started before dropPath; #1 was dropped; b.md proceeds.
    assert.deepStrictEqual(
      calls.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
      [['a.md', 0], ['b.md', 0]]
    );
  });

  it('continues draining other slides even if a saveFn throws', async () => {
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (p, idx) => {
        if (idx === 0) throw new Error('boom');
        calls.push(idx);
      }
    });
    q.enqueue('a.md', 0, 'fails', null);
    q.enqueue('a.md', 1, 'ok', null);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(calls, [1]);
  });
});

describe('SaveQueue — Promise-returning enqueue', () => {
  // Note: createSaveQueue runs inside a vm sandbox, so objects it returns
  // (saveFn results, COALESCED/DROPPED sentinels) have a different
  // Object.prototype than the test's main realm. assert.deepStrictEqual
  // therefore rejects structurally-equal values as "not reference-equal".
  // We compare fields individually with strictEqual instead.

  it('resolves enqueue() with the saveFn return value', async () => {
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async () => ({ ok: true, etag: '"abc"' })
    });
    const result = await q.enqueue('a.md', 0, 'hello', null);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.etag, '"abc"');
  });

  it('resolves the superseded enqueue() with COALESCED when overwritten', async () => {
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (_p, _idx, note) => {
        // Slow enough that a 2nd enqueue arrives while 1st is in-flight.
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, savedNote: note };
      }
    });
    const p1 = q.enqueue('a.md', 0, 'first', null); // starts immediately
    await new Promise((r) => setImmediate(r));
    const p2 = q.enqueue('a.md', 0, 'second', null); // sits pending
    const p3 = q.enqueue('a.md', 0, 'third', null);  // supersedes p2
    const r1 = await p1;
    const r2 = await p2;
    const r3 = await p3;
    // p1 actually ran. p2 was overwritten by p3 → COALESCED.
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.savedNote, 'first');
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.reason, 'COALESCED');
    assert.strictEqual(r3.ok, true);
    assert.strictEqual(r3.savedNote, 'third');
  });

  it('dropPath rejects pending enqueues with DROPPED', async () => {
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true };
      }
    });
    // Slide 0 starts immediately and runs to completion.
    const p0 = q.enqueue('a.md', 0, 'running', null);
    await new Promise((r) => setImmediate(r));
    // Slide 1 sits pending behind slide 0.
    const p1 = q.enqueue('a.md', 1, 'pending', null);
    q.dropPath('a.md');
    const r1 = await p1;
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(r1.reason, 'DROPPED');
    // The in-flight save for slide 0 still completes normally.
    const r0 = await p0;
    assert.strictEqual(r0.ok, true);
  });

  it('resolves enqueue() with an error result when saveFn throws', async () => {
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async () => { throw new Error('network down'); }
    });
    const result = await q.enqueue('a.md', 0, 'x', null);
    assert.strictEqual(result.ok, false);
    assert.match(String(result.reason), /network down/);
  });

  it('forwards the origin tag from enqueue() to saveFn', async () => {
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (_p, _idx, _note, _etag, origin) => {
        calls.push(origin);
        return { ok: true };
      }
    });
    await q.enqueue('a.md', 0, 'x', null, 'presenter');
    await q.enqueue('a.md', 1, 'y', null, 'inline');
    await q.enqueue('a.md', 2, 'z', null);  // origin omitted
    assert.deepStrictEqual(calls, ['presenter', 'inline', undefined]);
  });

  it('does NOT coalesce same-slide saves from different origins', async () => {
    // Cross-origin coalescing would silently drop one editor's draft —
    // an inline edit must not overwrite a pending presenter edit for
    // the same slide and vice versa.
    const calls = [];
    const { createSaveQueue } = loadQueue();
    const q = createSaveQueue({
      saveFn: async (_p, idx, note, _etag, origin) => {
        await new Promise((r) => setTimeout(r, 30));
        calls.push({ idx, note, origin });
        return { ok: true };
      }
    });
    const p1 = q.enqueue('a.md', 0, 'pres-1', null, 'presenter'); // starts
    await new Promise((r) => setImmediate(r));
    const p2 = q.enqueue('a.md', 0, 'inline-1', null, 'inline');  // pending, separate key
    const p3 = q.enqueue('a.md', 0, 'pres-2', null, 'presenter'); // coalesces p1's pending? — no, p1 is in-flight; this overwrites nothing yet, but if a NEW presenter pending existed, it would coalesce. Add a 4th to force coalesce within presenter origin only.
    const p4 = q.enqueue('a.md', 0, 'pres-3', null, 'presenter'); // overwrites p3 (same key)
    const r1 = await p1;
    const r2 = await p2;
    const r3 = await p3;
    const r4 = await p4;
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r3.ok, false);
    assert.strictEqual(r3.reason, 'COALESCED');
    assert.strictEqual(r4.ok, true);
    // Inline payload was NOT swallowed by the presenter saves.
    const inlineCalls = calls.filter((c) => c.origin === 'inline');
    assert.strictEqual(inlineCalls.length, 1);
    assert.strictEqual(inlineCalls[0].note, 'inline-1');
    // Presenter origin saw both pres-1 (in-flight) and pres-3 (coalesced
    // winner).
    const presenterCalls = calls.filter((c) => c.origin === 'presenter');
    const presenterNotes = presenterCalls.map((c) => c.note).sort();
    assert.deepStrictEqual(presenterNotes, ['pres-1', 'pres-3']);
  });
});
