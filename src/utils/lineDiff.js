/**
 * Dependency-free LINE-level diff — Myers O(ND) algorithm (Myers, 1986),
 * pure function. Backs src/services/changeJournal.js consumers and
 * src/api/diff.js (GET /api/diff).
 *
 * Contract: diffLines(oldText, newText) ->
 *   { added: [[startLine,endLine], ...],   // pure insertions (no old lines replaced)
 *     changed: [[startLine,endLine], ...], // replace hunks (old lines swapped for new)
 *     removedAt: [lineNumber, ...] }       // pure deletions: the NEW-text line
 *                                          // AFTER which they occurred (0 = before line 1)
 * — or `{ available: false }` if either side exceeds DIFF_MAX_LINES lines.
 *
 * All line numbers are 1-based positions in the NEW text, and `[start,end]`
 * ranges are inclusive.
 *
 * Line splitting:
 *  - CRLF (`\r\n`) and lone CR (`\r`) are normalized to `\n` before
 *    splitting, so line-ending style never produces a spurious diff.
 *  - A single trailing newline is NOT counted as an extra (empty) line —
 *    "a\n" and "a" both split to `['a']` — matching the common
 *    editor/git convention. A blank line before the final newline IS kept
 *    (`"a\n\n"` -> `['a', '']`, two lines).
 *  - Line numbers computed this way line up with the 1-based
 *    `data-source-line` markdown-it emits from `token.map` (src/rendering/
 *    markdown.js), since normalizing line endings never changes the line
 *    count.
 */

import { DIFF_MAX_LINES, DIFF_TRACE_BUDGET_BYTES } from '../config/constants.js';

/**
 * Split text into lines, normalizing CRLF/CR to LF first and dropping the
 * single trailing empty-string artifact `String.split('\n')` produces when
 * the text ends with a newline.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Myers forward search: builds the `trace` of V-arrays (furthest-reaching
 * x for each diagonal k, per edit-distance d) needed to backtrack the
 * shortest edit script. Reference: Eugene W. Myers, "An O(ND) Difference
 * Algorithm and Its Variations" (1986); the array-offset formulation here
 * follows the well-known two-part presentation of it (forward search +
 * backtrack), reimplemented from scratch (no external dependency).
 * @param {string[]} a - old lines
 * @param {string[]} b - new lines
 * @returns {{ trace: Int32Array[], N: number, M: number, MAX: number }}
 */
function buildTrace(a, b) {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;

  if (MAX === 0) {
    return { trace: [], N, M, MAX };
  }

  const offset = MAX;
  const v = new Int32Array(2 * MAX + 1);
  const trace = [];
  // Work/memory budget (codex P1): the trace stores a (2*MAX+1) Int32Array
  // per edit-distance step, so two mostly-different large files would
  // allocate gigabytes on an unauthenticated GET. A highlight preview of a
  // file where hundreds of line-edits happened is "everything changed"
  // anyway — bail to the same too-large signal the caller already handles.
  const traceBytesPerStep = (2 * MAX + 1) * 4;
  const maxSteps = Math.max(64, Math.floor(DIFF_TRACE_BUDGET_BYTES / traceBytesPerStep));

  for (let d = 0; d <= MAX; d++) {
    if (d > maxSteps) {
      return null; // budget exceeded -> caller reports { available: false }
    }
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        return { trace, N, M, MAX };
      }
    }
  }

  // Unreachable (the loop above always finds (N,M) by d = MAX at the
  // latest), but keep a defined return for safety.
  return { trace, N, M, MAX };
}

/**
 * Backtrack the trace from (N,M) to (0,0), producing the edit script in
 * forward (old-text / new-text increasing) order.
 * @param {{ trace: Int32Array[], N: number, M: number, MAX: number }} traceResult
 * @returns {Array<{type: 'equal'|'insert'|'delete', oldIndex?: number, newIndex?: number}>}
 */
function backtrack({ trace, N, M, MAX }) {
  if (trace.length === 0) return [];

  const offset = MAX;
  let x = N;
  let y = M;
  const ops = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'equal', oldIndex: x, newIndex: y });
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ type: 'insert', newIndex: y });
      } else {
        x--;
        ops.push({ type: 'delete', oldIndex: x });
      }
    }

    x = prevX;
    y = prevY;
  }

  ops.reverse();
  return ops;
}

/**
 * Group the forward edit script into hunks and translate them into the
 * public { added, changed, removedAt } shape.
 * @param {Array<{type: string, oldIndex?: number, newIndex?: number}>} ops
 * @returns {{ added: number[][], changed: number[][], removedAt: number[] }}
 */
function buildHunks(ops) {
  const added = [];
  const changed = [];
  const removedAt = [];

  let consumedNewLines = 0; // new-text lines emitted so far (equal + insert)
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      consumedNewLines++;
      i++;
      continue;
    }

    // Start of a maximal run of non-equal ops (one hunk).
    const beforeCount = consumedNewLines;
    let deleteCount = 0;
    let insertCount = 0;
    let insertMin = Infinity;
    let insertMax = -Infinity;

    while (i < ops.length && ops[i].type !== 'equal') {
      const op = ops[i];
      if (op.type === 'delete') {
        deleteCount++;
      } else {
        insertCount++;
        if (op.newIndex < insertMin) insertMin = op.newIndex;
        if (op.newIndex > insertMax) insertMax = op.newIndex;
        consumedNewLines++;
      }
      i++;
    }

    if (insertCount === 0) {
      // Pure deletion: no new-text line was produced for this hunk.
      removedAt.push(beforeCount);
    } else if (deleteCount === 0) {
      added.push([insertMin + 1, insertMax + 1]);
    } else {
      changed.push([insertMin + 1, insertMax + 1]);
    }
  }

  return { added, changed, removedAt };
}

/**
 * Compute a line-level diff between two full-text versions of a file.
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ added: number[][], changed: number[][], removedAt: number[] } | { available: false }}
 */
export function diffLines(oldText, newText) {
  const oldLines = splitLines(typeof oldText === 'string' ? oldText : '');
  const newLines = splitLines(typeof newText === 'string' ? newText : '');

  if (oldLines.length > DIFF_MAX_LINES || newLines.length > DIFF_MAX_LINES) {
    return { available: false };
  }

  const traceResult = buildTrace(oldLines, newLines);
  if (traceResult === null) {
    // Trace budget exceeded — same signal as the line-count cap.
    return { available: false };
  }
  const ops = backtrack(traceResult);
  return buildHunks(ops);
}

export default diffLines;
