/**
 * Marp speaker-note rewriter.
 *
 * Used by the Presenter View to write edited notes back into the source
 * markdown. Marp directives (`<!-- _class: invert -->`) are preserved;
 * only "freeform" comments are treated as speaker notes.
 *
 * Loaded both in the browser (via <script src=...>) and in Node tests
 * (via vm.runInContext, which exposes the API on `globalThis`).
 */
(function () {
  'use strict';

  const COMMENT_RE = /<!--([\s\S]*?)-->/g;

  // Known Marp/Marpit global and local directive keys. Comments whose every
  // non-empty line is `key: value` (or `_key: value`) using one of these keys
  // are directive comments and must be left untouched. Everything else —
  // including freeform text starting with labels like `Note:` or `TODO:` —
  // is treated as a speaker note.
  const MARP_DIRECTIVES = new Set([
    'marp', 'theme', 'style', 'headingDivider', 'paginate',
    'header', 'footer', 'class', 'color', 'size', 'transition',
    'lang',
    'backgroundColor', 'backgroundImage',
    'backgroundPosition', 'backgroundRepeat', 'backgroundSize'
  ]);
  const DIRECTIVE_LINE_RE = /^_?([a-zA-Z][a-zA-Z0-9]*)\s*:/;

  function isDirectiveComment(inner) {
    const lines = inner.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return lines.every((line) => {
      const m = line.match(DIRECTIVE_LINE_RE);
      return !!m && MARP_DIRECTIVES.has(m[1]);
    });
  }

  function formatNoteComment(text) {
    if (text.includes('\n')) return '<!--\n' + text + '\n-->';
    return '<!-- ' + text + ' -->';
  }

  // True when the line looks like a paragraph text line that could be
  // followed by a setext H2 underline. Excludes HTML blocks, headings,
  // blockquotes, lists, and lines that are themselves thematic breaks.
  function looksLikeParagraphLine(line) {
    const trimmed = line.replace(/^\s+/, '');
    if (!trimmed) return false;
    const c = trimmed[0];
    if (c === '<') return false; // HTML block / comment line (incl. `-->`)
    if (c === '#') return false; // ATX heading
    if (c === '>') return false; // blockquote
    if (/^[-*+][ \t]/.test(trimmed)) return false; // bullet list
    if (/^\d+[.)][ \t]/.test(trimmed)) return false; // ordered list
    if (/^(?:[-*_][ \t]*){3,}\s*$/.test(trimmed)) return false; // thematic break
    return true;
  }

  // CommonMark thematic break: 3+ same chars (-, *, _) with optional spaces
  // between, up to 3 leading spaces, trailing whitespace allowed. All three
  // are slide separators in Marp (thematic_break tokens).
  const THEMATIC_BREAK_RE = /^\s{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})\s*$/;

  /**
   * Walk the body line by line, recording fence enter/exit positions and
   * every thematic-break line outside fences. When `headingDivider` is set,
   * also record zero-length virtual separators before headings of level ≤
   * the divider value, mirroring Marpit's heading-based slide splitting.
   */
  function scanBody(body, headingDividerLevels) {
    const lines = body.split('\n');
    const lineSpans = [];
    const fenceRanges = [];
    const candidates = [];

    let pos = 0;
    let inFence = false;
    let fenceMarker = null;
    let fenceStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasNewline = i < lines.length - 1;
      const lineLen = line.length + (hasNewline ? 1 : 0);
      const trimmedTail = line.endsWith('\r') ? line.slice(0, -1) : line;
      lineSpans.push({ start: pos, end: pos + lineLen, text: trimmedTail });

      if (inFence) {
        const closeMatch = trimmedTail.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        if (
          closeMatch
          && closeMatch[1][0] === fenceMarker[0]
          && closeMatch[1].length >= fenceMarker.length
        ) {
          inFence = false;
          fenceMarker = null;
          fenceRanges.push({ start: fenceStart, end: pos + lineLen });
          fenceStart = -1;
        }
      } else {
        const fenceMatch = trimmedTail.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fenceMatch) {
          inFence = true;
          fenceMarker = fenceMatch[1];
          fenceStart = pos;
        } else if (THEMATIC_BREAK_RE.test(trimmedTail)) {
          // Only `---` is ambiguous: it is a setext H2 underline when it
          // immediately follows a *paragraph* line. HTML blocks (e.g. the
          // closing `-->` of a comment), headings, blockquotes, and lists
          // are not paragraphs, so a `---` after them is a real thematic
          // break. `***`/`___` are unambiguous breaks.
          const isHyphen = /^[ \t]*-/.test(trimmedTail);
          if (isHyphen && i > 0 && looksLikeParagraphLine(lineSpans[i - 1].text)) {
            // setext underline → not a slide separator
          } else {
            candidates.push({ start: pos, end: pos + lineLen, type: 'explicit', lineIdx: i });
          }
        } else if (headingDividerLevels) {
          const hMatch = trimmedTail.match(/^(#{1,6})\s/);
          if (hMatch && headingDividerLevels.has(hMatch[1].length)) {
            candidates.push({ start: pos, end: pos, type: 'heading', lineIdx: i });
          }
        }
      }
      pos += lineLen;
    }
    if (inFence && fenceStart >= 0) {
      fenceRanges.push({ start: fenceStart, end: pos });
    }

    // Pre-compute directive comment ranges so heading-divider candidates
    // don't see leading directive-only lines (e.g. `<!-- _class: invert -->`)
    // as content. Marp wouldn't emit an empty slide before the first
    // heading in that case. Comments inside fenced code are sample code,
    // not directives, so skip them.
    const directiveRanges = [];
    COMMENT_RE.lastIndex = 0;
    let cm;
    while ((cm = COMMENT_RE.exec(body)) !== null) {
      if (isInsideAnyRange(fenceRanges, cm.index)) continue;
      if (isDirectiveComment(cm[1])) {
        directiveRanges.push({ start: cm.index, end: cm.index + cm[0].length });
      }
    }

    function lineIsContent(lineIdx) {
      const ls = lineSpans[lineIdx];
      const lineText = body.slice(ls.start, ls.end);
      if (!lineText.trim()) return false;
      // Compute the line's content with directive-comment ranges removed.
      let cursor = ls.start;
      let stripped = '';
      for (const r of directiveRanges) {
        if (r.end <= ls.start || r.start >= ls.end) continue;
        if (r.start <= ls.start && r.end >= ls.end) {
          // Line is fully inside a directive comment.
          return false;
        }
        if (r.start > cursor) stripped += body.slice(cursor, r.start);
        cursor = Math.max(cursor, Math.min(r.end, ls.end));
      }
      stripped += body.slice(cursor, ls.end);
      return !!stripped.trim();
    }

    const seps = [];
    let lastBoundaryLineIdx = -1;
    for (const cand of candidates) {
      if (cand.type === 'explicit') {
        seps.push({ start: cand.start, end: cand.end });
        lastBoundaryLineIdx = cand.lineIdx;
        continue;
      }
      let hasContent = false;
      for (let j = lastBoundaryLineIdx + 1; j < cand.lineIdx; j++) {
        if (lineIsContent(j)) { hasContent = true; break; }
      }
      if (hasContent) {
        seps.push({ start: cand.start, end: cand.end });
        lastBoundaryLineIdx = cand.lineIdx - 1;
      }
    }

    return { seps, fenceRanges };
  }

  function isInsideAnyRange(ranges, index) {
    for (const r of ranges) if (index >= r.start && index < r.end) return true;
    return false;
  }

  function collectFenceRanges(segment) {
    return scanBody(segment, null).fenceRanges;
  }

  // Returns a Set of heading levels at which slides should split, or null.
  // Marpit accepts both scalar form (`headingDivider: 2` → {1, 2}) and
  // array form (`headingDivider: [1, 3]` → {1, 3}).
  function decodeHeadingDividerValue(rhs) {
    const trimmed = rhs.trim();
    const arrMatch = trimmed.match(/^\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]$/);
    if (arrMatch) {
      const nums = arrMatch[1]
        .split(/\s*,\s*/)
        .map((n) => parseInt(n, 10))
        .filter((n) => n >= 1 && n <= 6);
      return nums.length ? new Set(nums) : null;
    }
    const scalarMatch = trimmed.match(/^(\d+)/);
    if (scalarMatch) {
      const n = parseInt(scalarMatch[1], 10);
      if (n >= 1 && n <= 6) {
        const set = new Set();
        for (let i = 1; i <= n; i++) set.add(i);
        return set;
      }
    }
    return null;
  }

  function parseHeadingDivider(raw) {
    const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
    if (fmMatch) {
      const fm = fmMatch[1];
      for (const line of fm.split(/\r?\n/)) {
        const m = line.match(/^_?headingDivider\s*:\s*(.+)$/);
        if (m) {
          const set = decodeHeadingDividerValue(m[1]);
          if (set) return set;
        }
      }
    }
    // Marp also accepts global directives in HTML comments (without the
    // `_` prefix). Only the underscore-less form changes the global divider
    // for the rest of the deck. Skip comments inside fenced code blocks —
    // those are sample code, not directives.
    const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
    const fenceRanges = collectFenceRanges(body);
    COMMENT_RE.lastIndex = 0;
    let m;
    while ((m = COMMENT_RE.exec(body)) !== null) {
      if (isInsideAnyRange(fenceRanges, m.index)) continue;
      const inner = m[1];
      const lines = inner.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const dm = line.match(/^headingDivider\s*:\s*(.+)$/);
        if (dm) {
          const set = decodeHeadingDividerValue(dm[1]);
          if (set) return set;
        }
      }
    }
    return null;
  }

  function splitSlidesByPositions(body, seps) {
    const slides = [];
    const separators = [];
    let lastEnd = 0;
    for (const sep of seps) {
      slides.push(body.slice(lastEnd, sep.start));
      separators.push(body.slice(sep.start, sep.end));
      lastEnd = sep.end;
    }
    slides.push(body.slice(lastEnd));
    return { slides, separators };
  }

  /**
   * Remove the comment occupying [index, index+length) along with the
   * horizontal whitespace immediately surrounding it on its own line, and
   * up to one trailing newline. This narrow scope avoids collapsing blank
   * lines elsewhere in the slide (e.g. inside fenced code blocks).
   */
  function spliceCommentRange(s, index, length) {
    let lo = index;
    let hi = index + length;
    while (lo > 0 && (s[lo - 1] === ' ' || s[lo - 1] === '\t')) lo--;
    while (hi < s.length && (s[hi] === ' ' || s[hi] === '\t')) hi++;
    if (hi < s.length && s[hi] === '\r') hi++;
    if (hi < s.length && s[hi] === '\n') hi++;
    return { result: s.slice(0, lo) + s.slice(hi), removedAt: lo, removedLen: hi - lo };
  }

  function updateSlideSegmentNote(segment, newNote) {
    const trimmedNew = (newNote || '').trim();

    // Comments inside fenced code blocks are sample content, not speaker
    // notes — skip them so editing the slide's note never rewrites a code
    // sample's comment.
    const fenceRanges = collectFenceRanges(segment);

    const comments = [];
    let m;
    COMMENT_RE.lastIndex = 0;
    while ((m = COMMENT_RE.exec(segment)) !== null) {
      if (isInsideAnyRange(fenceRanges, m.index)) continue;
      const inner = m[1];
      comments.push({
        index: m.index,
        length: m[0].length,
        isDirective: isDirectiveComment(inner)
      });
    }
    const noteComments = comments.filter((c) => !c.isDirective);

    // Strategy: collapse all existing speaker-note comments into a single
    // canonical comment placed where the first one was. Marp's rendered
    // notes are already a flattened join of every non-directive comment,
    // so we must save back exactly one comment — otherwise stale fragments
    // resurface on the next reload.

    let out = segment;
    let firstInsertionPoint = -1;
    let cumulativeOffset = 0;

    // Process in original order so the recorded firstInsertionPoint refers
    // to the post-removal coordinate space.
    for (const c of noteComments) {
      const adjIndex = c.index - cumulativeOffset;
      const { result, removedAt, removedLen } = spliceCommentRange(out, adjIndex, c.length);
      out = result;
      if (firstInsertionPoint < 0) firstInsertionPoint = removedAt;
      cumulativeOffset += removedLen;
    }

    if (trimmedNew === '') {
      return out;
    }

    const formatted = formatNoteComment(trimmedNew);

    if (firstInsertionPoint >= 0) {
      // Reinsert the canonical comment in place of the first removed one,
      // restoring the trailing newline that spliceCommentRange consumed.
      return out.slice(0, firstInsertionPoint) + formatted + '\n' + out.slice(firstInsertionPoint);
    }

    // No prior speaker note — append at the end of the segment. Always
    // keep a trailing newline; with zero-length virtual separators (heading
    // dividers) the next slide starts on the very next line, so dropping
    // the newline would jam our note against the next heading and break
    // Marp's slide split.
    return out.replace(/\s*$/, '') + '\n\n' + formatted + '\n';
  }

  /**
   * Speaker notes are stored as HTML comments, so the text cannot contain
   * `-->`, `--!>`, or end with `--` — those would prematurely close the
   * comment and corrupt the surrounding markdown. Reject up front so the
   * caller can surface a useful error instead of writing bad bytes to disk.
   */
  function validateNoteText(text) {
    if (typeof text !== 'string') return null;
    if (text.includes('-->')) return 'cannot contain "-->"';
    if (text.includes('--!>')) return 'cannot contain "--!>"';
    if (/--\s*$/.test(text)) return 'cannot end with "--"';
    return null;
  }

  function updateMarpNoteInRaw(raw, slideIndex, newNote) {
    const reason = validateNoteText(newNote);
    if (reason) {
      const err = new Error('Speaker note ' + reason);
      err.code = 'INVALID_NOTE';
      throw err;
    }

    const fmMatch = raw.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
    const frontmatter = fmMatch ? fmMatch[0] : '';
    const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

    const headingDivider = parseHeadingDivider(raw);
    const { seps } = scanBody(body, headingDivider);
    const { slides, separators } = splitSlidesByPositions(body, seps);
    if (slideIndex < 0 || slideIndex >= slides.length) return raw;

    slides[slideIndex] = updateSlideSegmentNote(slides[slideIndex], newNote);

    let rebuilt = '';
    for (let i = 0; i < slides.length; i++) {
      rebuilt += slides[i];
      if (i < separators.length) rebuilt += separators[i];
    }
    return frontmatter + rebuilt;
  }

  const api = {
    updateMarpNoteInRaw,
    updateSlideSegmentNote,
    formatNoteComment,
    validateNoteText
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.MarpNoteRewriter = api;
  }
})();
