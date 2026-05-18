/**
 * Tests for src/static/lib/presenterChannel.js — pure JS, no DOM required.
 *
 * The browser-side library exposes itself on `globalThis.MDVPresenterChannel`.
 * We load it into an isolated VM context so we can exercise it under Node.
 * `create()` (BroadcastChannel) is not exercised here — it needs a browser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(
  path.join(here, '..', 'src', 'static', 'lib', 'presenterChannel.js'),
  'utf-8'
);

// `extras` lets a test omit `crypto` to exercise the fallback path.
function loadModule(extras = {}) {
  const sandbox = vm.createContext({ console, ...extras });
  vm.runInContext(code, sandbox);
  return sandbox.MDVPresenterChannel;
}

describe('presenterChannel — module surface', () => {
  it('exposes CHANNEL_NAME, create, newWindowId', () => {
    const mod = loadModule({ crypto: nodeCrypto });
    assert.equal(mod.CHANNEL_NAME, 'mdv-marp-presenter');
    assert.equal(typeof mod.create, 'function');
    assert.equal(typeof mod.newWindowId, 'function');
  });
});

describe('presenterChannel — newWindowId (save routing)', () => {
  it('returns a unique non-empty string on every call (crypto.randomUUID)', () => {
    const mod = loadModule({ crypto: nodeCrypto });
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = mod.newWindowId();
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 0, 'window id must be non-empty');
      ids.add(id);
    }
    assert.equal(ids.size, 1000, 'window ids must all be unique');
  });

  it('falls back to a unique id when crypto.randomUUID is unavailable', () => {
    // No `crypto` in the sandbox → the typeof guard takes the fallback.
    const mod = loadModule();
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = mod.newWindowId();
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 0, 'fallback window id must be non-empty');
      ids.add(id);
    }
    assert.equal(ids.size, 1000, 'fallback window ids must all be unique');
  });
});
