/**
 * Tests for src/static/lib/marpDiffMap.js — pure JS, no DOM required.
 *
 * The DOM wiring (contentRenderer.js's dot + modules/marpDiffIndicator.js)
 * is verified separately via the Playwright E2E spec, not here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { changedSlideIndices } from '../src/static/lib/marpDiffMap.js';

// Three slides: lines 1-3, 4-6, 7-9 (one-based inclusive, matching
// src/api/diff.js's slideRanges convention).
const SLIDE_RANGES = [
  { start: 1, end: 3 },
  { start: 4, end: 6 },
  { start: 7, end: 9 }
];

describe('marpDiffMap.changedSlideIndices', () => {
  it('maps a range entirely inside one slide to that slide only', () => {
    const result = changedSlideIndices([[5, 5]], SLIDE_RANGES);
    assert.deepStrictEqual([...result], [1]);
  });

  it('maps multiple non-overlapping ranges to their respective slides', () => {
    const result = changedSlideIndices([[2, 2], [8, 9]], SLIDE_RANGES);
    assert.deepStrictEqual([...result].sort(), [0, 2]);
  });

  it('a range spanning a slide boundary marks BOTH slides', () => {
    const result = changedSlideIndices([[3, 4]], SLIDE_RANGES);
    assert.deepStrictEqual([...result].sort(), [0, 1]);
  });

  it('a range with no overlap marks nothing', () => {
    const result = changedSlideIndices([[100, 105]], SLIDE_RANGES);
    assert.strictEqual(result.size, 0);
  });

  it('the same slide is only added once even with multiple overlapping ranges', () => {
    const result = changedSlideIndices([[4, 4], [5, 5], [6, 6]], SLIDE_RANGES);
    assert.deepStrictEqual([...result], [1]);
  });

  it('returns an empty Set for missing/malformed input instead of throwing', () => {
    assert.strictEqual(changedSlideIndices(undefined, SLIDE_RANGES).size, 0);
    assert.strictEqual(changedSlideIndices([[1, 2]], undefined).size, 0);
    assert.strictEqual(changedSlideIndices([], SLIDE_RANGES).size, 0);
    assert.strictEqual(changedSlideIndices([[1, 2]], []).size, 0);
  });
});
