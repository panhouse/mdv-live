/**
 * Tests for src/utils/lineMath.js — line / byte conversion with BOM, CRLF, CR.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeLineStarts, analyseSource, lineRangeToOffsets } from '../src/utils/lineMath.js';

describe('lineMath', () => {
  describe('computeLineStarts', () => {
    it('handles LF', () => {
      assert.deepStrictEqual(computeLineStarts('a\nb\nc'), [0, 2, 4]);
    });
    it('handles CRLF as a single break', () => {
      assert.deepStrictEqual(computeLineStarts('a\r\nb\r\nc'), [0, 3, 6]);
    });
    it('handles CR-only as a single break', () => {
      assert.deepStrictEqual(computeLineStarts('a\rb\rc'), [0, 2, 4]);
    });
    it('returns [0] for empty string', () => {
      assert.deepStrictEqual(computeLineStarts(''), [0]);
    });
    it('treats trailing newline as starting a new (empty) line', () => {
      // 'a\n' has lines: 'a' and ''. Two starts.
      assert.deepStrictEqual(computeLineStarts('a\n'), [0, 2]);
    });
  });

  describe('analyseSource', () => {
    it('detects LF as the dominant line ending', () => {
      const r = analyseSource('a\nb\nc\n');
      assert.strictEqual(r.lineEnding, '\n');
      assert.strictEqual(r.hasBom, false);
      assert.strictEqual(r.endsWithNewline, true);
    });
    it('detects CRLF dominance', () => {
      const r = analyseSource('a\r\nb\r\nc\r\n');
      assert.strictEqual(r.lineEnding, '\r\n');
    });
    it('detects BOM and preserves it in lineStarts[0] === 0', () => {
      const r = analyseSource('﻿hello\n');
      assert.strictEqual(r.hasBom, true);
      assert.strictEqual(r.lineStarts[0], 0);
    });
    it('detects no trailing newline', () => {
      const r = analyseSource('a\nb');
      assert.strictEqual(r.endsWithNewline, false);
    });
  });

  describe('lineRangeToOffsets', () => {
    it('maps explicit endLine inside source', () => {
      const src = 'a\nb\nc\n';
      const { lineStarts } = analyseSource(src);
      const totalLines = 3; // 'a', 'b', 'c'
      const r = lineRangeToOffsets(lineStarts, totalLines, src.length, 0, 1);
      assert.strictEqual(src.slice(r.startOffset, r.endOffset), 'a\n');
    });
    it('handles endLine === totalLines (to source end)', () => {
      const src = 'a\nb\nc';
      const { lineStarts } = analyseSource(src);
      const r = lineRangeToOffsets(lineStarts, 3, src.length, 2, 3);
      assert.strictEqual(src.slice(r.startOffset, r.endOffset), 'c');
    });
  });
});
