/**
 * Tests for src/static/lib/tabRegistry.js — pure JS, no DOM required.
 *
 * The registry keeps its listener arrays at module scope (there is
 * intentionally one shared registry per page, mirroring the browser
 * global), so each test registers fresh listeners and asserts on the
 * behavior of just its own calls to notifyClosed()/notifySwitched().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  onTabClosed,
  onTabSwitched,
  notifyClosed,
  notifySwitched
} from '../src/static/lib/tabRegistry.js';

describe('tabRegistry — listener registration + invocation order', () => {
  it('invokes onTabClosed listeners in registration order with the closed path', () => {
    const calls = [];
    onTabClosed((path) => calls.push(['first', path]));
    onTabClosed((path) => calls.push(['second', path]));
    notifyClosed('a.md');
    assert.deepStrictEqual(calls, [['first', 'a.md'], ['second', 'a.md']]);
  });

  it('invokes onTabSwitched listeners in registration order with the active path', () => {
    const calls = [];
    onTabSwitched((path) => calls.push(['first', path]));
    onTabSwitched((path) => calls.push(['second', path]));
    notifySwitched('b.md');
    assert.deepStrictEqual(calls, [['first', 'b.md'], ['second', 'b.md']]);
  });

  it('close listeners and switch listeners are independent lists', () => {
    const closeCalls = [];
    const switchCalls = [];
    onTabClosed((path) => closeCalls.push(path));
    onTabSwitched((path) => switchCalls.push(path));
    notifyClosed('close-only.md');
    assert.deepStrictEqual(closeCalls, ['close-only.md']);
    assert.deepStrictEqual(switchCalls, []);
    notifySwitched('switch-only.md');
    assert.deepStrictEqual(switchCalls, ['switch-only.md']);
  });

  it('a listener that throws does not stop the remaining listeners from running', () => {
    const calls = [];
    onTabClosed(() => { throw new Error('boom'); });
    onTabClosed((path) => calls.push(path));
    // Should not throw out of notifyClosed() itself.
    assert.doesNotThrow(() => notifyClosed('c.md'));
    assert.deepStrictEqual(calls, ['c.md']);
  });

  it('silently ignores non-function arguments instead of registering them', () => {
    const calls = [];
    onTabClosed(null);
    onTabClosed(undefined);
    onTabClosed('not a function');
    onTabClosed((path) => calls.push(path));
    notifyClosed('d.md');
    assert.deepStrictEqual(calls, ['d.md']);
  });
});
