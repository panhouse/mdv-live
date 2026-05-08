/**
 * Tests for src/concurrency/pathLock.js — proves the promise-chain mutex
 * serializes multiple concurrent waiters (the audit's #1 P1 against the
 * previous naive Map implementation).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { withLock, _activeKeyCount } from '../src/concurrency/pathLock.js';

describe('withLock', () => {
  it('runs in strict FIFO under three parallel waiters', async () => {
    const order = [];
    const all = await Promise.all([
      withLock('k', async () => {
        order.push('1-start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('1-end');
        return 1;
      }),
      withLock('k', async () => {
        order.push('2-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('2-end');
        return 2;
      }),
      withLock('k', async () => {
        order.push('3-start');
        order.push('3-end');
        return 3;
      })
    ]);
    assert.deepStrictEqual(all, [1, 2, 3]);
    assert.deepStrictEqual(order, [
      '1-start', '1-end',
      '2-start', '2-end',
      '3-start', '3-end'
    ]);
  });

  it('different keys do not block each other', async () => {
    const order = [];
    const a = withLock('a', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
    });
    const b = withLock('b', async () => {
      order.push('b-start');
      order.push('b-end');
    });
    await Promise.all([a, b]);
    // b must complete entirely before a-end (they're independent keys)
    assert.ok(order.indexOf('b-end') < order.indexOf('a-end'));
  });

  it('releases the lock when fn throws', async () => {
    await assert.rejects(() => withLock('e', async () => { throw new Error('boom'); }));
    let ran = false;
    await withLock('e', async () => { ran = true; });
    assert.strictEqual(ran, true);
  });

  it('cleans up tail map after settling', async () => {
    await withLock('cleanup', async () => {});
    // Allow microtask queue to flush.
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(_activeKeyCount(), 0);
  });

  it('serializes 5 concurrent waiters with the same key (no thundering-herd)', async () => {
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, () => withLock('shared', async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }))
    );
    assert.strictEqual(maxActive, 1, 'expected at most one critical section at a time');
  });
});
