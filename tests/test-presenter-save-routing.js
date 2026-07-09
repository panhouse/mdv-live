/**
 * Tests for src/static/lib/presenterSaveRouting.js — pure JS, no DOM
 * required. Covers the save-routing protocol extracted from presenter.html
 * (pin-on-slides, send-or-defer, find-saver timeout, ack timeout / failover,
 * saver-here re-pin, note-saved classification).
 *
 * Uses real (short) timers, same approach as test-debounce.js: the module
 * under test is a thin wrapper around setTimeout/clearTimeout, so exercising
 * the actual timer queue is simpler and less brittle than faking it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSaveRouter } from '../src/static/lib/presenterSaveRouting.js';
import { TYPES } from '../src/static/lib/presenterChannel.js';
import { ERROR_CODES } from '../src/static/lib/errorCodes.js';

const ACK_MS = 20;
const FIND_SAVER_MS = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRouter(overrides = {}) {
  const sent = [];
  const noSaverCalls = [];
  const saveStartCalls = [];
  let seq = 0;
  const router = createSaveRouter({
    postMessage: (msg) => sent.push(msg),
    newRequestId: () => 'req-' + (++seq),
    onNoSaverFound: (path) => noSaverCalls.push(path),
    onSaveStart: (payload) => saveStartCalls.push(payload),
    ackTimeoutMs: ACK_MS,
    findSaverTimeoutMs: FIND_SAVER_MS,
    ...overrides
  });
  return { router, sent, noSaverCalls, saveStartCalls };
}

describe('presenterSaveRouting — module surface', () => {
  it('exposes createSaveRouter as a function', () => {
    assert.equal(typeof createSaveRouter, 'function');
  });

  it('returns the expected method surface', () => {
    const { router } = makeRouter();
    for (const name of ['pinFromSlides', 'sendEditNote', 'handleSaverHere', 'handleNoteSaved', 'requestSaver', 'failOver', '_debugState']) {
      assert.equal(typeof router[name], 'function', `missing method ${name}`);
    }
  });
});

describe('presenterSaveRouting — pinFromSlides (window pinning)', () => {
  it('pins the first sourceWindowId when nothing is pinned yet', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    assert.equal(router._debugState().saverWindowId, 'w1');
  });

  it('does not re-pin to a different window for the same deck once pinned', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.pinFromSlides({ prevDeckPath: 'a.md', path: 'a.md', sourceWindowId: 'w2' });
    assert.equal(router._debugState().saverWindowId, 'w1', 'first pin must stick for the same deck');
  });

  it('re-pins on a deck switch even though a saver is already pinned', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.pinFromSlides({ prevDeckPath: 'a.md', path: 'b.md', sourceWindowId: 'w2' });
    assert.equal(router._debugState().saverWindowId, 'w2', 'deck switch must re-pin to the new sourceWindowId');
  });

  it('does nothing when sourceWindowId is falsy', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: undefined });
    assert.equal(router._debugState().saverWindowId, null);
  });

  it('does not treat an unchanged path as a deck switch', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: 'a.md', path: 'a.md', sourceWindowId: 'w1' });
    router.pinFromSlides({ prevDeckPath: 'a.md', path: 'a.md', sourceWindowId: 'w2' });
    assert.equal(router._debugState().saverWindowId, 'w1');
  });
});

describe('presenterSaveRouting — sendEditNote (send or defer)', () => {
  it('calls onSaveStart every time, regardless of pin state', () => {
    const { router, saveStartCalls } = makeRouter();
    const payload = { path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' };
    router.sendEditNote(payload);
    assert.equal(saveStartCalls.length, 1);
    assert.deepStrictEqual(saveStartCalls[0], payload);
  });

  it('defers the edit and broadcasts find-saver when no saver is pinned yet', () => {
    const { router, sent } = makeRouter();
    const payload = { path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' };
    router.sendEditNote(payload);
    assert.deepStrictEqual(router._debugState().pendingSave, payload);
    assert.equal(router._debugState().inflightSave, null);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, TYPES.FIND_SAVER);
    assert.equal(sent[0].path, 'a.md');
  });

  it('routes directly with a fresh requestId + targetWindowId when a saver is pinned', () => {
    const { router, sent } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 2, note: 'hello', etag: 'e1' });
    assert.equal(sent.length, 1);
    assert.deepStrictEqual(sent[0], {
      type: TYPES.EDIT_NOTE,
      path: 'a.md',
      etag: 'e1',
      slideIndex: 2,
      note: 'hello',
      requestId: 'req-1',
      targetWindowId: 'w1'
    });
    assert.deepStrictEqual(router._debugState().inflightSave, {
      path: 'a.md', slideIndex: 2, note: 'hello', etag: 'e1', requestId: 'req-1'
    });
  });

  it('gives every actual send a new requestId, even resends of the same edit', () => {
    const { router, sent } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    const payload = { path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' };
    router.sendEditNote(payload);
    router.sendEditNote(payload);
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0].requestId, sent[1].requestId);
  });
});

describe('presenterSaveRouting — requestSaver timeout', () => {
  it('calls onNoSaverFound and clears pendingSave when nobody answers in time', async () => {
    const { router, noSaverCalls } = makeRouter();
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: null });
    assert.equal(router._debugState().pendingSave !== null, true);
    await sleep(FIND_SAVER_MS * 2);
    assert.deepStrictEqual(noSaverCalls, ['a.md']);
    assert.equal(router._debugState().pendingSave, null);
  });

  it('does not call onNoSaverFound when a saver-here reply resolves pendingSave first', async () => {
    const { router, noSaverCalls } = makeRouter();
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: null });
    router.handleSaverHere({ path: 'a.md', windowId: 'w9' });
    await sleep(FIND_SAVER_MS * 2);
    assert.deepStrictEqual(noSaverCalls, []);
  });
});

describe('presenterSaveRouting — handleSaverHere (re-pin + resend)', () => {
  it('pins the answering window and resends the deferred edit', () => {
    const { router, sent } = makeRouter();
    const payload = { path: 'a.md', slideIndex: 1, note: 'x', etag: 'e1' };
    router.sendEditNote(payload); // defers, broadcasts find-saver
    const matched = router.handleSaverHere({ path: 'a.md', windowId: 'w7' });
    assert.equal(matched, true);
    assert.equal(router._debugState().saverWindowId, 'w7');
    assert.equal(router._debugState().pendingSave, null);
    // second message in `sent` is the resent edit-note.
    assert.equal(sent[1].type, TYPES.EDIT_NOTE);
    assert.equal(sent[1].targetWindowId, 'w7');
    assert.equal(sent[1].note, 'x');
  });

  it('ignores a reply for a different path than the pending edit', () => {
    const { router, sent } = makeRouter();
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: null });
    const matched = router.handleSaverHere({ path: 'b.md', windowId: 'w7' });
    assert.equal(matched, false);
    assert.notEqual(router._debugState().pendingSave, null);
    assert.equal(sent.length, 1, 'no resend should have been sent');
  });

  it('is a no-op when there is no pendingSave', () => {
    const { router, sent } = makeRouter();
    const matched = router.handleSaverHere({ path: 'a.md', windowId: 'w7' });
    assert.equal(matched, false);
    assert.equal(sent.length, 0);
  });

  it('first answer wins: a second saver-here after the first is already resolved is a no-op', () => {
    const { router, sent } = makeRouter();
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: null });
    const first = router.handleSaverHere({ path: 'a.md', windowId: 'w1' });
    const second = router.handleSaverHere({ path: 'a.md', windowId: 'w2' });
    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(router._debugState().saverWindowId, 'w1', 'second reply must not steal the pin');
    assert.equal(sent.length, 2, 'find-saver + one resend only');
  });

  it('requires a windowId on the reply', () => {
    const { router } = makeRouter();
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: null });
    const matched = router.handleSaverHere({ path: 'a.md', windowId: undefined });
    assert.equal(matched, false);
  });
});

describe('presenterSaveRouting — ack timeout -> failover', () => {
  it('un-pins and re-broadcasts find-saver for the same edit when the saver never acks', async () => {
    const { router, sent } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 3, note: 'x', etag: 'e1' });
    assert.equal(router._debugState().saverWindowId, 'w1');
    await sleep(ACK_MS * 2);
    assert.equal(router._debugState().saverWindowId, null, 'ack timeout must un-pin the dead saver');
    assert.equal(router._debugState().inflightSave, null);
    assert.deepStrictEqual(router._debugState().pendingSave, {
      path: 'a.md', slideIndex: 3, note: 'x', etag: 'e1', requestId: 'req-1'
    });
    const findSaverMsgs = sent.filter((m) => m.type === TYPES.FIND_SAVER);
    assert.equal(findSaverMsgs.length, 1, 'the timed-out edit must trigger exactly one find-saver retry');
  });

  it('resending after failover uses a fresh requestId', async () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    await sleep(ACK_MS * 2); // ack times out -> failOver -> pendingSave queued
    router.handleSaverHere({ path: 'a.md', windowId: 'w2' });
    assert.equal(router._debugState().inflightSave.requestId, 'req-2');
  });
});

describe('presenterSaveRouting — handleNoteSaved classification', () => {
  it('returns "drop" for a foreign requestId (superseded/other routed save)', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    const result = router.handleNoteSaved({ requestId: 'not-ours', ok: true });
    assert.equal(result, 'drop');
    // Must not have touched our own inflight save.
    assert.notEqual(router._debugState().inflightSave, null);
  });

  it('returns "continue" and clears inflightSave on our own genuine ack', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    const ourRequestId = router._debugState().inflightSave.requestId;
    const result = router.handleNoteSaved({ requestId: ourRequestId, ok: true, etag: 'e2' });
    assert.equal(result, 'continue');
    assert.equal(router._debugState().inflightSave, null);
  });

  it('clears the ack timer on a genuine ack (no later failover fires)', async () => {
    const { router, sent } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    const ourRequestId = router._debugState().inflightSave.requestId;
    router.handleNoteSaved({ requestId: ourRequestId, ok: true, etag: 'e2' });
    await sleep(ACK_MS * 2);
    // If the ack timer had not been cleared, this would have failed over
    // (un-pinning w1 and broadcasting another find-saver).
    assert.equal(router._debugState().saverWindowId, 'w1');
    assert.equal(sent.filter((m) => m.type === TYPES.FIND_SAVER).length, 0);
  });

  it('returns "failover" and retries the same edit on NO_DECK', () => {
    const { router, sent } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 5, note: 'x', etag: 'e1' });
    const ourRequestId = router._debugState().inflightSave.requestId;
    const result = router.handleNoteSaved({ requestId: ourRequestId, ok: false, code: ERROR_CODES.NO_DECK });
    assert.equal(result, 'failover');
    assert.equal(router._debugState().saverWindowId, null);
    assert.deepStrictEqual(router._debugState().pendingSave, {
      path: 'a.md', slideIndex: 5, note: 'x', etag: 'e1', requestId: ourRequestId
    });
    assert.equal(sent.filter((m) => m.type === TYPES.FIND_SAVER).length, 1);
  });

  it('returns "continue" for a requestId-less broadcast (inline save) without touching routing state', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    const before = router._debugState();
    const result = router.handleNoteSaved({ path: 'a.md', slideIndex: 0, ok: true, origin: 'inline' });
    assert.equal(result, 'continue');
    assert.deepStrictEqual(router._debugState(), before, 'a requestId-less message must not alter routing state');
  });

  it('treats a null/undefined requestId ack as unrouted even if something is inflight', () => {
    const { router } = makeRouter();
    router.pinFromSlides({ prevDeckPath: '', path: 'a.md', sourceWindowId: 'w1' });
    router.sendEditNote({ path: 'a.md', slideIndex: 0, note: 'x', etag: 'e1' });
    const result = router.handleNoteSaved({ requestId: null, ok: false, reason: 'STALE' });
    assert.equal(result, 'continue');
    assert.notEqual(router._debugState().inflightSave, null, 'inflightSave must survive an unrelated ack');
  });
});
