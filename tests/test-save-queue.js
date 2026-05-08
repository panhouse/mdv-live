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
