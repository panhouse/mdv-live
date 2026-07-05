/**
 * Tests for src/static/lib/marpZoom.js — pure JS, no DOM required.
 *
 * The focal-point scrolling and DOM wiring (app.js → MarpZoom) are verified
 * separately via the Playwright dogfood, not here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as Z from '../src/static/lib/marpZoom.js';

const RATIO_16_9 = 720 / 1280; // 0.5625

describe('marpZoom — module surface', () => {
  it('exposes the zoom math API + bounds', () => {
    assert.equal(Z.ZOOM_MIN, 1);
    assert.equal(Z.ZOOM_MAX, 6);
    for (const fn of ['containFit', 'clampZoom', 'zoomForWheel', 'zoomForStep', 'isFit']) {
      assert.equal(typeof Z[fn], 'function', `${fn} should be a function`);
    }
  });
});

describe('marpZoom — containFit (the "whole slide visible" guarantee)', () => {
  it('fills width and never overflows height on a WIDE/short pane', () => {
    // Regression: the cutoff bug. A pane wider than 16:9 used to size the
    // slide by width alone, overflowing the pane vertically.
    const { w, h } = Z.containFit(1634, 471, RATIO_16_9);
    assert.ok(h <= 471 + 0.5, `height ${h} must fit pane height 471`);
    assert.ok(w <= 1634 + 0.5, `width ${w} must fit pane width 1634`);
    // height-limited here, so it should be pinned to the pane height.
    assert.ok(Math.abs(h - 471) < 1, 'should use the full pane height');
    assert.ok(Math.abs(h / w - RATIO_16_9) < 1e-6, 'aspect ratio preserved');
  });

  it('fills height and never overflows width on a TALL/narrow pane', () => {
    const { w, h } = Z.containFit(614, 671, RATIO_16_9);
    assert.ok(w <= 614 + 0.5, `width ${w} must fit pane width 614`);
    assert.ok(h <= 671 + 0.5, `height ${h} must fit pane height 671`);
    // width-limited here, so it should be pinned to the pane width.
    assert.ok(Math.abs(w - 614) < 1, 'should use the full pane width');
    assert.ok(Math.abs(h / w - RATIO_16_9) < 1e-6, 'aspect ratio preserved');
  });

  it('fits exactly when the pane already matches 16:9', () => {
    const { w, h } = Z.containFit(1280, 720, RATIO_16_9);
    assert.ok(Math.abs(w - 1280) < 1 && Math.abs(h - 720) < 1);
  });

  it('falls back to a 1px box for degenerate (zero / negative) panes', () => {
    assert.deepEqual(Z.containFit(0, 500, RATIO_16_9), { w: 1, h: 1 });
    assert.deepEqual(Z.containFit(500, 0, RATIO_16_9), { w: 1, h: 1 });
    assert.deepEqual(Z.containFit(500, 500, 0), { w: 1, h: 1 });
  });
});

describe('marpZoom — clampZoom', () => {
  it('keeps zoom within [MIN, MAX]', () => {
    assert.equal(Z.clampZoom(0.2), 1);
    assert.equal(Z.clampZoom(1), 1);
    assert.equal(Z.clampZoom(3.5), 3.5);
    assert.equal(Z.clampZoom(99), 6);
  });

  it('coerces non-finite zoom to the fit (MIN) — the safe default', () => {
    assert.equal(Z.clampZoom(NaN), 1);
    assert.equal(Z.clampZoom(Infinity), 1);
    assert.equal(Z.clampZoom(-Infinity), 1);
  });
});

describe('marpZoom — zoomForWheel (pinch)', () => {
  it('pinch open (deltaY < 0) zooms in, pinch close zooms out', () => {
    assert.ok(Z.zoomForWheel(2, -120) > 2, 'negative delta zooms in');
    assert.ok(Z.zoomForWheel(2, +120) < 2, 'positive delta zooms out');
  });

  it('result is always clamped to the allowed range', () => {
    assert.equal(Z.zoomForWheel(6, -100000), 6, 'cannot exceed MAX');
    assert.equal(Z.zoomForWheel(1, +100000), 1, 'cannot drop below MIN');
  });

  it('is symmetric: a delta and its negation compose back to the start', () => {
    const start = 2.5;
    const inThenOut = Z.zoomForWheel(Z.zoomForWheel(start, -80), +80);
    assert.ok(Math.abs(inThenOut - start) < 1e-9);
  });
});

describe('marpZoom — zoomForStep (keyboard +/-) and isFit', () => {
  it('steps in/out and clamps', () => {
    assert.ok(Z.zoomForStep(2, 1) > 2);
    assert.ok(Z.zoomForStep(2, -1) < 2);
    assert.equal(Z.zoomForStep(1, -1), 1, 'stepping out at fit stays at fit');
    assert.equal(Z.zoomForStep(6, 1), 6, 'stepping in at max stays at max');
  });

  it('isFit is true only at (or just above) MIN', () => {
    assert.equal(Z.isFit(1), true);
    assert.equal(Z.isFit(1.0005), true);
    assert.equal(Z.isFit(1.2), false);
    assert.equal(Z.isFit(6), false);
  });
});
