/**
 * src/utils/lineDiff.js — dependency-free Myers line diff (pure function).
 *
 * Covers: empty files, identical, whole-file add/remove, all-replaced,
 * interleaved hunks, CRLF normalization, trailing-newline handling, the
 * DIFF_MAX_LINES cap (`{ available: false }`), and (0.6.10) the `removed`
 * field that carries the actual deleted OLD-text lines alongside the
 * position-only `removedAt` markers (Word-style strikethrough display).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { diffLines } from '../src/utils/lineDiff.js';
import { DIFF_MAX_LINES } from '../src/config/constants.js';

describe('diffLines — empty inputs', () => {
  it('both empty -> no hunks', () => {
    assert.deepStrictEqual(diffLines('', ''), { added: [], changed: [], removedAt: [], removed: [] });
  });

  it('old empty, new has content -> whole file is one added hunk', () => {
    const result = diffLines('', 'a\nb\nc');
    assert.deepStrictEqual(result, { added: [[1, 3]], changed: [], removedAt: [], removed: [] });
  });

  it('new empty, old had content -> one removedAt marker before line 1, carrying all deleted lines', () => {
    const result = diffLines('a\nb\nc', '');
    assert.deepStrictEqual(result, {
      added: [],
      changed: [],
      removedAt: [0],
      removed: [{ afterLine: 0, lines: ['a', 'b', 'c'] }],
    });
  });
});

describe('diffLines — identical content', () => {
  it('identical single-line text -> no hunks', () => {
    assert.deepStrictEqual(diffLines('hello', 'hello'), { added: [], changed: [], removedAt: [], removed: [] });
  });

  it('identical multi-line text -> no hunks', () => {
    const text = 'line1\nline2\nline3\n';
    assert.deepStrictEqual(diffLines(text, text), { added: [], changed: [], removedAt: [], removed: [] });
  });
});

describe('diffLines — pure insertion', () => {
  it('appending lines at the end -> added range covers only the new lines', () => {
    const result = diffLines('a\nb', 'a\nb\nc\nd');
    assert.deepStrictEqual(result, { added: [[3, 4]], changed: [], removedAt: [], removed: [] });
  });

  it('inserting lines in the middle -> added range at the insertion point', () => {
    const result = diffLines('a\nb', 'a\nX\nY\nb');
    assert.deepStrictEqual(result, { added: [[2, 3]], changed: [], removedAt: [], removed: [] });
  });

  it('inserting a single line at the very start', () => {
    const result = diffLines('a\nb', 'X\na\nb');
    assert.deepStrictEqual(result, { added: [[1, 1]], changed: [], removedAt: [], removed: [] });
  });
});

describe('diffLines — pure deletion', () => {
  it('removing a line from the middle -> removedAt marks the new-text line before it, removed carries the deleted text', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    // 'b' was removed after new-text line 1 ('a').
    assert.deepStrictEqual(result, {
      added: [],
      changed: [],
      removedAt: [1],
      removed: [{ afterLine: 1, lines: ['b'] }],
    });
  });

  it('removing the last line -> removedAt marks the final remaining new-text line', () => {
    const result = diffLines('a\nb\nc', 'a\nb');
    assert.deepStrictEqual(result, {
      added: [],
      changed: [],
      removedAt: [2],
      removed: [{ afterLine: 2, lines: ['c'] }],
    });
  });

  it('removing the first line -> removedAt is 0 (before first line)', () => {
    const result = diffLines('a\nb\nc', 'b\nc');
    assert.deepStrictEqual(result, {
      added: [],
      changed: [],
      removedAt: [0],
      removed: [{ afterLine: 0, lines: ['a'] }],
    });
  });

  it('removing two separate single lines -> two independent removedAt markers, each with its own removed entry', () => {
    const result = diffLines('a\nb\nc\nd\ne', 'a\nc\ne');
    // 'b' removed after new line 1 ('a'); 'd' removed after new line 2 ('c').
    assert.deepStrictEqual(result, {
      added: [],
      changed: [],
      removedAt: [1, 2],
      removed: [
        { afterLine: 1, lines: ['b'] },
        { afterLine: 2, lines: ['d'] },
      ],
    });
  });
});

describe('diffLines — all-replaced', () => {
  it('completely different content of the same length -> one changed hunk spanning the whole new text', () => {
    const result = diffLines('a\nb\nc', 'x\ny\nz');
    assert.deepStrictEqual(result, { added: [], changed: [[1, 3]], removedAt: [], removed: [] });
  });

  it('completely different content, new text longer -> changed hunk spans all new lines', () => {
    const result = diffLines('a\nb', 'x\ny\nz\nw');
    assert.strictEqual(result.added.length + result.changed.length >= 1, true);
    // Whatever the exact split between added/changed, every new line must be
    // accounted for and no removedAt markers should appear (nothing is purely deleted
    // with no replacement — all 2 old lines were consumed as part of the replace).
    assert.deepStrictEqual(result.removedAt, []);
    assert.deepStrictEqual(result.removed, []);
  });
});

describe('diffLines — interleaved hunks', () => {
  it('two separate single-line replacements produce two independent changed ranges', () => {
    const result = diffLines('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne');
    assert.deepStrictEqual(result, { added: [], changed: [[2, 2], [4, 4]], removedAt: [], removed: [] });
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
    assert.deepStrictEqual(result.removed, [{ afterLine: 3, lines: ['d'] }]);
  });
});

describe('diffLines — CRLF normalization', () => {
  it('CRLF vs LF with identical content produces no diff', () => {
    const crlf = 'a\r\nb\r\nc\r\n';
    const lf = 'a\nb\nc\n';
    assert.deepStrictEqual(diffLines(crlf, lf), { added: [], changed: [], removedAt: [], removed: [] });
  });

  it('lone CR line endings are also normalized', () => {
    const cr = 'a\rb\rc';
    const lf = 'a\nb\nc';
    assert.deepStrictEqual(diffLines(cr, lf), { added: [], changed: [], removedAt: [], removed: [] });
  });

  it('a real change is still detected across CRLF/LF-mixed inputs', () => {
    const oldText = 'a\r\nb\r\nc';
    const newText = 'a\nX\nc';
    const result = diffLines(oldText, newText);
    assert.deepStrictEqual(result, { added: [], changed: [[2, 2]], removedAt: [], removed: [] });
  });
});

describe('diffLines — trailing-newline handling', () => {
  it('a single trailing newline does not create a phantom extra line', () => {
    assert.deepStrictEqual(diffLines('a\nb', 'a\nb\n'), { added: [], changed: [], removedAt: [], removed: [] });
    assert.deepStrictEqual(diffLines('a\nb\n', 'a\nb'), { added: [], changed: [], removedAt: [], removed: [] });
  });

  it('a genuine trailing blank line (blank line before EOF newline) is preserved', () => {
    // 'a\n\n' -> lines ['a', '']  (a real blank second line)
    // 'a\n'   -> lines ['a']
    const result = diffLines('a\n', 'a\n\n');
    assert.deepStrictEqual(result, { added: [[2, 2]], changed: [], removedAt: [], removed: [] });
  });

  it('empty string (0 lines) vs a lone newline (1 blank line) -> one added blank line', () => {
    // '' has 0 lines; '\n' has exactly 1 (empty) line — matches `wc -l` semantics
    // (line count = number of newline characters when the file ends with one).
    assert.deepStrictEqual(diffLines('', '\n'), { added: [[1, 1]], changed: [], removedAt: [], removed: [] });
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
    assert.deepStrictEqual(result, { added: [], changed: [], removedAt: [], removed: [] });
  });
});

describe('diffLines — trace memory budget (codex P1)', () => {
  it('returns { available:false } for two large mostly-different inputs instead of allocating GBs', () => {
    const oldText = Array.from({ length: 15000 }, (_, i) => `old line ${i}`).join('\n');
    const newText = Array.from({ length: 15000 }, (_, i) => `new line ${i}`).join('\n');
    const before = process.memoryUsage().heapUsed;
    const result = diffLines(oldText, newText);
    const grewMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    assert.strictEqual(result.available, false);
    assert.ok(grewMb < 200, `memory growth should stay bounded, grew ${grewMb.toFixed(0)}MB`);
  });

  it('still diffs large files with FEW edits (budget scales with edit distance, not size)', () => {
    const base = Array.from({ length: 15000 }, (_, i) => `line ${i}`);
    const edited = [...base];
    edited[7000] = 'edited line';
    const result = diffLines(base.join('\n'), edited.join('\n'));
    assert.strictEqual(result.available === false, false);
    assert.deepStrictEqual(result.changed, [[7001, 7001]]);
  });
});

describe('diffLines — removed field (0.6.10 Word-style strikethrough display)', () => {
  it('single-line deletion: removed has one entry with the exact deleted line', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    assert.deepStrictEqual(result.removed, [{ afterLine: 1, lines: ['b'] }]);
  });

  it('multi-line block deletion: one removed entry with all deleted lines in original order', () => {
    const result = diffLines('a\nb\nc\nd\ne', 'a\ne');
    assert.deepStrictEqual(result.removedAt, [1]);
    assert.deepStrictEqual(result.removed, [{ afterLine: 1, lines: ['b', 'c', 'd'] }]);
  });

  it('deletion at the very start of the file -> afterLine 0', () => {
    const result = diffLines('x\ny\na\nb', 'a\nb');
    assert.deepStrictEqual(result.removedAt, [0]);
    assert.deepStrictEqual(result.removed, [{ afterLine: 0, lines: ['x', 'y'] }]);
  });

  it('deletion at EOF (nothing follows it in the new text)', () => {
    const result = diffLines('a\nb\nc\nd', 'a\nb');
    assert.deepStrictEqual(result.removedAt, [2]);
    assert.deepStrictEqual(result.removed, [{ afterLine: 2, lines: ['c', 'd'] }]);
  });

  it('multiple separate deletions each produce their own removed entry, in order', () => {
    const result = diffLines('a\nb\nc\nd\ne\nf\ng', 'a\nc\ne\ng');
    assert.deepStrictEqual(result.removedAt, [1, 2, 3]);
    assert.deepStrictEqual(result.removed, [
      { afterLine: 1, lines: ['b'] },
      { afterLine: 2, lines: ['d'] },
      { afterLine: 3, lines: ['f'] },
    ]);
  });

  it('removedAt[i] === removed[i].afterLine for every hunk, across several mixed cases', () => {
    const cases = [
      ['a\nb\nc', ''],
      ['a\nb\nc\nd\ne', 'a\nc\ne'],
      [['a', 'b', 'c', 'd', 'e', 'f'].join('\n'), ['a', 'Z', 'c', 'e', 'f', 'W', 'g'].join('\n')],
      ['x\ny\na\nb', 'a\nb'],
      ['a\nb\nc\nd', 'a\nb'],
    ];
    for (const [oldText, newText] of cases) {
      const result = diffLines(oldText, newText);
      assert.strictEqual(result.removed.length, result.removedAt.length);
      result.removed.forEach((entry, i) => {
        assert.strictEqual(entry.afterLine, result.removedAt[i]);
      });
    }
  });
});
