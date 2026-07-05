/**
 * Tests for src/static/lib/presenterChannel.js — pure JS, no DOM required.
 *
 * `create()` (BroadcastChannel) is not exercised here — it needs a browser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CHANNEL_NAME, create, newWindowId } from '../src/static/lib/presenterChannel.js';

// newWindowId's fallback path only runs when `crypto.randomUUID` is
// unavailable. Real Node has a global `crypto` (WebCrypto) with
// `randomUUID`, so we temporarily remove the global to exercise the
// fallback, then restore the original property descriptor.
function withoutGlobalCrypto(fn) {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    return fn();
  } finally {
    if (orig) Object.defineProperty(globalThis, 'crypto', orig);
  }
}

describe('presenterChannel — module surface', () => {
  it('exposes CHANNEL_NAME, create, newWindowId', () => {
    assert.equal(CHANNEL_NAME, 'mdv-marp-presenter');
    assert.equal(typeof create, 'function');
    assert.equal(typeof newWindowId, 'function');
  });
});

describe('presenterChannel — newWindowId (save routing)', () => {
  it('returns a unique non-empty string on every call (crypto.randomUUID)', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = newWindowId();
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 0, 'window id must be non-empty');
      ids.add(id);
    }
    assert.equal(ids.size, 1000, 'window ids must all be unique');
  });

  it('falls back to a unique id when crypto.randomUUID is unavailable', () => {
    withoutGlobalCrypto(() => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        const id = newWindowId();
        assert.equal(typeof id, 'string');
        assert.ok(id.length > 0, 'fallback window id must be non-empty');
        ids.add(id);
      }
      assert.equal(ids.size, 1000, 'fallback window ids must all be unique');
    });
  });
});
