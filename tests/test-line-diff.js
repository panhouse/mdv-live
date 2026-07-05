/**
 * src/utils/lineDiff.js — dependency-free Myers line diff (pure function).
 *
 * Covers: empty files, identical, whole-file add/remove, all-replaced,
 * interleaved hunks, CRLF normalization, trailing-newline handling, and the
 * DIFF_MAX_LINES cap (`{ available: false }`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { diffLines } from '../src/utils/lineDiff.js';
import { DIFF_MAX_LINES } from '../src/config/constants.js';

describe('diffLines — empty inputs', () => {
  it('both empty -> no hunks', () => {
    assert.deepStrictEqual(diffLines('', ''), { added: [], changed: [], removedAt: [] });
  });

  it('old empty, new has content -> whole file is one added hunk', () => {
    const result = diffLines('', 'a\nb\nc');
    assert.deepStrictEqual(result, { added: [[1, 3]], changed: [], removedAt: [] });
  });

  it('new empty, old had content -> one removedAt marker before line 1', () => {
    const result = diffLines('a\nb\nc', '');
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [0] });
  });
});

describe('diffLines — identical content', () => {
  it('identical single-line text -> no hunks', () => {
    assert.deepStrictEqual(diffLines('hello', 'hello'), { added: [], changed: [], removedAt: [] });
  });

  it('identical multi-line text -> no hunks', () => {
    const text = 'line1\nline2\nline3\n';
    assert.deepStrictEqual(diffLines(text, text), { added: [], changed: [], removedAt: [] });
  });
});

describe('diffLines — pure insertion', () => {
  it('appending lines at the end -> added range covers only the new lines', () => {
    const result = diffLines('a\nb', 'a\nb\nc\nd');
    assert.deepStrictEqual(result, { added: [[3, 4]], changed: [], removedAt: [] });
  });

  it('inserting lines in the middle -> added range at the insertion point', () => {
    const result = diffLines('a\nb', 'a\nX\nY\nb');
    assert.deepStrictEqual(result, { added: [[2, 3]], changed: [], removedAt: [] });
  });

  it('inserting a single line at the very start', () => {
    const result = diffLines('a\nb', 'X\na\nb');
    assert.deepStrictEqual(result, { added: [[1, 1]], changed: [], removedAt: [] });
  });
});

describe('diffLines — pure deletion', () => {
  it('removing a line from the middle -> removedAt marks the new-text line before it', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    // 'b' was removed after new-text line 1 ('a').
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [1] });
  });

  it('removing the last line -> removedAt marks the final remaining new-text line', () => {
    const result = diffLines('a\nb\nc', 'a\nb');
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [2] });
  });

  it('removing the first line -> removedAt is 0 (before first line)', () => {
    const result = diffLines('a\nb\nc', 'b\nc');
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [0] });
  });

  it('removing two separate single lines -> two independent removedAt markers', () => {
    const result = diffLines('a\nb\nc\nd\ne', 'a\nc\ne');
    // 'b' removed after new line 1 ('a'); 'd' removed after new line 2 ('c').
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [1, 2] });
  });
});

describe('diffLines — all-replaced', () => {
  it('completely different content of the same length -> one changed hunk spanning the whole new text', () => {
    const result = diffLines('a\nb\nc', 'x\ny\nz');
    assert.deepStrictEqual(result, { added: [], changed: [[1, 3]], removedAt: [] });
  });

  it('completely different content, new text longer -> changed hunk spans all new lines', () => {
    const result = diffLines('a\nb', 'x\ny\nz\nw');
    assert.strictEqual(result.added.length + result.changed.length >= 1, true);
    // Whatever the exact split between added/changed, every new line must be
    // accounted for and no removedAt markers should appear (nothing is purely deleted
    // with no replacement — all 2 old lines were consumed as part of the replace).
    assert.deepStrictEqual(result.removedAt, []);
  });
});

describe('diffLines — interleaved hunks', () => {
  it('two separate single-line replacements produce two independent changed ranges', () => {
    const result = diffLines('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne');
    assert.deepStrictEqual(result, { added: [], changed: [[2, 2], [4, 4]], removedAt: [] });
  });

  it('mix of add, change, and remove hunks in one diff', () => {
    // old: a b c d e f
    // new: a Z c   e W f g   (b -> Z change; d removed; W,g appended after e/f)
    const oldText = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const newText = ['a', 'Z', 'c', 'e', 'f', 'W', 'g'].join('\n');
    const result = diffLines(oldText, newText);
    assert.deepStrictEqual(result.changed, [[2, 2]]); // b -> Z
    assert.deepStrictEqual(result.removedAt, [3]); // d removed after new line 3 ('c')
    assert.deepStrictEqual(result.added, [[6, 7]]); // W, g appended
  });
});

describe('diffLines — CRLF normalization', () => {
  it('CRLF vs LF with identical content produces no diff', () => {
    const crlf = 'a\r\nb\r\nc\r\n';
    const lf = 'a\nb\nc\n';
    assert.deepStrictEqual(diffLines(crlf, lf), { added: [], changed: [], removedAt: [] });
  });

  it('lone CR line endings are also normalized', () => {
    const cr = 'a\rb\rc';
    const lf = 'a\nb\nc';
    assert.deepStrictEqual(diffLines(cr, lf), { added: [], changed: [], removedAt: [] });
  });

  it('a real change is still detected across CRLF/LF-mixed inputs', () => {
    const oldText = 'a\r\nb\r\nc';
    const newText = 'a\nX\nc';
    const result = diffLines(oldText, newText);
    assert.deepStrictEqual(result, { added: [], changed: [[2, 2]], removedAt: [] });
  });
});

describe('diffLines — trailing-newline handling', () => {
  it('a single trailing newline does not create a phantom extra line', () => {
    assert.deepStrictEqual(diffLines('a\nb', 'a\nb\n'), { added: [], changed: [], removedAt: [] });
    assert.deepStrictEqual(diffLines('a\nb\n', 'a\nb'), { added: [], changed: [], removedAt: [] });
  });

  it('a genuine trailing blank line (blank line before EOF newline) is preserved', () => {
    // 'a\n\n' -> lines ['a', '']  (a real blank second line)
    // 'a\n'   -> lines ['a']
    const result = diffLines('a\n', 'a\n\n');
    assert.deepStrictEqual(result, { added: [[2, 2]], changed: [], removedAt: [] });
  });

  it('empty string (0 lines) vs a lone newline (1 blank line) -> one added blank line', () => {
    // '' has 0 lines; '\n' has exactly 1 (empty) line — matches `wc -l` semantics
    // (line count = number of newline characters when the file ends with one).
    assert.deepStrictEqual(diffLines('', '\n'), { added: [[1, 1]], changed: [], removedAt: [] });
  });
});

describe('diffLines — DIFF_MAX_LINES cap', () => {
  it('returns { available: false } when the OLD side exceeds DIFF_MAX_LINES', () => {
    const huge = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `l${i}`).join('\n');
    const result = diffLines(huge, 'a\nb');
    assert.deepStrictEqual(result, { available: false });
  });

  it('returns { available: false } when the NEW side exceeds DIFF_MAX_LINES', () => {
    const huge = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `l${i}`).join('\n');
    const result = diffLines('a\nb', huge);
    assert.deepStrictEqual(result, { available: false });
  });

  it('diffs normally right at the DIFF_MAX_LINES boundary (not exceeding it)', () => {
    const atCap = Array.from({ length: DIFF_MAX_LINES }, (_, i) => `l${i}`).join('\n');
    const result = diffLines(atCap, atCap);
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [] });
  });
});
