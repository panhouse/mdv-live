/**
 * Tests for src/static/lib/debounce.js — pure JS, no DOM required.
 *
 * Uses real (short) timers rather than mocked ones: the module under test
 * is a thin wrapper around setTimeout/clearTimeout, so exercising the
 * actual timer queue is simpler and less brittle than faking it here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDebouncedAction } from '../src/static/lib/debounce.js';

const DELAY_MS = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('debounce — module surface', () => {
  it('exposes schedule/flush/cancel as functions', () => {
    const action = createDebouncedAction({ fn: () => {}, delayMs: DELAY_MS });
    assert.equal(typeof action.schedule, 'function');
    assert.equal(typeof action.flush, 'function');
    assert.equal(typeof action.cancel, 'function');
  });
});

describe('debounce — schedule()', () => {
  it('fires fn once after delayMs of inactivity', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    assert.equal(calls, 0, 'must not fire synchronously');
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 1, 'must fire exactly once after the delay');
  });

  it('collapses a burst of schedule() calls into a single fn call (debounce)', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    action.schedule();
    action.schedule();
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 1, 'only the last schedule() in the burst should fire');
  });

  it('can be scheduled again after firing (new cycle)', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 1);
    action.schedule();
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 2, 'a fresh schedule() after the previous fire should fire again');
  });
});

describe('debounce — flush()', () => {
  it('fires fn immediately when a schedule() is pending, and only once', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    action.flush();
    assert.equal(calls, 1, 'flush() must fire fn synchronously');
    // The original timer must be cancelled — waiting past the original
    // delay must NOT produce a second call.
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 1, 'flush() must cancel the pending timer, not just race it');
  });

  it('is a no-op when nothing is pending', () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.flush();
    assert.equal(calls, 0, 'flush() with no pending schedule() must not call fn');
  });
});

describe('debounce — cancel()', () => {
  it('drops a pending schedule() without ever calling fn', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    action.cancel();
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 0, 'cancel() must prevent fn from ever firing for that schedule()');
  });

  it('is a no-op when nothing is pending', () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.cancel();
    assert.equal(calls, 0);
  });

  it('does not block a later schedule() from firing', async () => {
    let calls = 0;
    const action = createDebouncedAction({ fn: () => { calls++; }, delayMs: DELAY_MS });
    action.schedule();
    action.cancel();
    action.schedule();
    await sleep(DELAY_MS * 2);
    assert.equal(calls, 1, 'a schedule() after cancel() must still fire on its own');
  });
});
