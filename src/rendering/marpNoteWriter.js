/**
 * Speaker-note rewriter — pure function operating on a parsed deck.
 *
 * Strategy:
 *   - At most ONE speaker note per slide is supported by auto-save (see
 *     Multi-note Guard below). The Plan caps editing to single-note slides
 *     so that the join-of-comments string round-trips losslessly.
 *   - Rewriting replaces or removes the existing single note token's line
 *     range, or appends a new comment if the slide has no note.
 *   - Marp directives are left untouched (they are not in `classifiedNotes`,
 *     so `pickNoteComments` filters them out).
 */

import { pickNoteComments } from './marpitAdapter.js';
import { lineRangeToOffsets } from '../utils/lineMath.js';
import { mkError } from '../utils/errors.js';

/** Speaker notes are stored as HTML comments. Reject text that would close
 *  or invalidate the comment on the markdown side. */
export function validateNoteText(text) {
  if (typeof text !== 'string') return 'note must be a string';
  if (text.length > 64 * 1024) return 'note exceeds 64 KiB';
  if (/\u0000/.test(text)) return 'note contains NUL';
  if (text.includes('-->')) return 'note cannot contain "-->"';
  if (text.includes('--!>')) return 'note cannot contain "--!>"';
  if (/--\s*$/.test(text)) return 'note cannot end with "--"';
  return null;
}

export function formatNoteComment(text, lineEnding) {
  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    // Normalise embedded newlines to the file's line ending.
    const normalised = trimmed.replace(/\r\n|\r|\n/g, lineEnding);
    return '<!--' + lineEnding + normalised + lineEnding + '-->';
  }
  return '<!-- ' + trimmed + ' -->';
}

/**
 * Find the line index where a new note comment should be inserted into a
 * slide that has no existing note. Walks backwards from `endLine - 1` and
 * returns the line *after* the last non-blank line.
 */
function findInsertionLine(rawSource, lineStarts, totalLines, range) {
  let line = Math.min(range.endLine, totalLines) - 1;
  while (line > range.startLine) {
    const start = lineStarts[line];
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : rawSource.length;
    const text = rawSource.slice(start, end);
    if (text.replace(/\r?\n$/, '').trim().length > 0) {
      return line + 1; // insert immediately after this content line
    }
    line--;
  }
  return range.startLine + 1; // default: just after the slide's first line
}

/**
 * @param {string} rawSource
 * @param {number} slideIndex
 * @param {string} newNote  empty string == remove
 * @param {ReturnType<import('./marpitAdapter.js').parseDeck>} parsed
 * @param {ReturnType<import('../utils/lineMath.js').analyseSource>} lineInfo
 * @returns {{ source: string, changed: boolean }}
 */
export function rewriteSlideNote(rawSource, slideIndex, newNote, parsed, lineInfo) {
  if (slideIndex < 0 || slideIndex >= parsed.slideCount) {
    throw mkError('OUT_OF_RANGE', `slideIndex ${slideIndex} out of range`);
  }
  const reason = validateNoteText(newNote);
  if (reason) throw mkError('INVALID_NOTE', reason);

  const noteStrings = parsed.classifiedNotes[slideIndex] || [];
  const candidates = parsed.commentsBySlide[slideIndex] || [];
  const noteComments = pickNoteComments(candidates, noteStrings);

  // Multi-note Guard (defense-in-depth): even if the client misbehaves and
  // POSTs against a slide that has multiple speaker notes, refuse — joining
  // them into a single string is lossy round-trip.
  if (noteComments.length > 1) {
    throw mkError(
      'MULTI_NOTE_READONLY',
      'slide has multiple speaker notes; auto-save disabled'
    );
  }

  const totalLines = parsed.slideRanges[parsed.slideCount - 1].endLine;
  const { lineStarts } = lineInfo;
  const lineEnding = lineInfo.lineEnding;
  const trimmedNew = newNote.trim();

  if (trimmedNew === '' && noteComments.length === 0) {
    return { source: rawSource, changed: false };
  }

  if (trimmedNew === '') {
    // Remove the single existing note token, including the line break that
    // delimits it. Does NOT touch surrounding code blocks.
    const c = noteComments[0];
    const { startOffset, endOffset } = lineRangeToOffsets(
      lineStarts, totalLines, rawSource.length, c.startLine, c.endLine
    );
    return {
      source: rawSource.slice(0, startOffset) + rawSource.slice(endOffset),
      changed: true
    };
  }

  const formatted = formatNoteComment(trimmedNew, lineEnding);

  if (noteComments.length === 1) {
    // Replace the single existing comment's line range.
    const c = noteComments[0];
    const { startOffset, endOffset } = lineRangeToOffsets(
      lineStarts, totalLines, rawSource.length, c.startLine, c.endLine
    );
    // Preserve the trailing newline of the line we replace, if any.
    const preserveTrailingNewline = endOffset < rawSource.length
      || /(?:\r\n|\r|\n)$/.test(rawSource.slice(startOffset, endOffset));
    return {
      source:
        rawSource.slice(0, startOffset) +
        formatted +
        (preserveTrailingNewline ? lineEnding : '') +
        rawSource.slice(endOffset),
      changed: true
    };
  }

  // Insert a new comment at the slide's last non-blank line + 1.
  const range = parsed.slideRanges[slideIndex];
  const insertLine = findInsertionLine(rawSource, lineStarts, totalLines, range);
  const insertOffset = insertLine < lineStarts.length
    ? lineStarts[insertLine]
    : rawSource.length;

  const inserted = formatted + lineEnding + lineEnding;
  // If the slide had no trailing blank line, we need to introduce a blank
  // line between content and our comment.
  const needsLeadingBlank = (() => {
    if (insertOffset === 0) return false;
    const before = rawSource.slice(0, insertOffset);
    return !/(?:\r\n\r\n|\n\n|\r\r)$/.test(before);
  })();
  const prefix = needsLeadingBlank ? lineEnding : '';

  return {
    source:
      rawSource.slice(0, insertOffset) +
      prefix +
      inserted +
      rawSource.slice(insertOffset),
    changed: true
  };
}
