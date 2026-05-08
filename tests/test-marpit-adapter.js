/**
 * MarpitTokenAdapter 契約テスト。
 *
 * @marp-team/marp-core の API 挙動を snapshot で固定する。これらが破れた
 * = メジャー仕様変更 → adapter の前提が崩れているので CI で検知する。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDeck, pickNoteComments, countLines, renderDeck } from '../src/rendering/marpitAdapter.js';

const FRONTMATTER = '---\nmarp: true\n---\n';

describe('MarpitTokenAdapter contract', () => {
  describe('parseDeck', () => {
    it('returns slide ranges with [startLine, endLine] aligned to next slide_open', () => {
      const md = `${FRONTMATTER}# A\n\n---\n\n# B\n\n---\n\n# C\n`;
      const r = parseDeck(md);
      assert.strictEqual(r.slideCount, 3);
      // slide 1: starts at frontmatter line 0, ends before slide 2 starts
      assert.strictEqual(r.slideRanges[0].startLine, 0);
      assert.ok(r.slideRanges[0].endLine > 0);
      assert.strictEqual(r.slideRanges[1].startLine, r.slideRanges[0].endLine);
      assert.strictEqual(r.slideRanges[2].startLine, r.slideRanges[1].endLine);
    });

    it('groups speaker notes per slide via classifiedNotes', () => {
      const md = `${FRONTMATTER}# A\n\n<!-- a1 -->\n<!-- a2 -->\n\n---\n\n# B\n\n<!-- b -->\n`;
      const r = parseDeck(md);
      assert.deepStrictEqual(r.classifiedNotes, [['a1', 'a2'], ['b']]);
      assert.deepStrictEqual(r.notesMultiplicity, [2, 1]);
      assert.strictEqual(r.commentsBySlide[0].length, 2);
      assert.strictEqual(r.commentsBySlide[1].length, 1);
    });

    it('excludes directive comments from classifiedNotes', () => {
      const md = `${FRONTMATTER}<!-- _class: invert -->\n\n# A\n\n<!-- speaker note -->\n`;
      const r = parseDeck(md);
      assert.deepStrictEqual(r.classifiedNotes[0], ['speaker note']);
      // commentsBySlide includes BOTH the directive AND the note
      assert.strictEqual(r.commentsBySlide[0].length, 2);
    });

    it('trims marpit_comment.content on both sides', () => {
      const md = `${FRONTMATTER}# A\n\n<!--   surrounded by spaces   -->\n`;
      const r = parseDeck(md);
      assert.strictEqual(r.commentsBySlide[0][0].content, 'surrounded by spaces');
    });

    it('captures multi-line comment content with internal newlines', () => {
      const md = `${FRONTMATTER}# A\n\n<!--\nline 1\nline 2\n-->\n`;
      const r = parseDeck(md);
      assert.strictEqual(r.commentsBySlide[0][0].content, 'line 1\nline 2');
      // map covers all lines from the opening `<!--` to the closing `-->`
      assert.ok(r.commentsBySlide[0][0].endLine - r.commentsBySlide[0][0].startLine >= 4);
    });

    it('emits one slide_open even without frontmatter', () => {
      const md = '# A\n\n<!-- note -->\n';
      const r = parseDeck(md);
      assert.strictEqual(r.slideCount, 1);
      assert.deepStrictEqual(r.classifiedNotes, [['note']]);
    });

    it('handles BOM-prefixed source (slide_open.map[0] === 0)', () => {
      const md = '﻿' + FRONTMATTER + '# A\n\n<!-- note -->\n';
      const r = parseDeck(md);
      assert.strictEqual(r.slideRanges[0].startLine, 0);
      assert.deepStrictEqual(r.classifiedNotes[0], ['note']);
    });
  });

  describe('headingDivider', () => {
    it('honors scalar headingDivider', () => {
      const md = `---\nmarp: true\nheadingDivider: 2\n---\n# Top\n## A\nbody A\n## B\nbody B\n`;
      const r = parseDeck(md);
      // # Top, ## A, ## B → 3 slides
      assert.strictEqual(r.slideCount, 3);
    });

    it('honors inline-array headingDivider', () => {
      const md = `---\nmarp: true\nheadingDivider: [1, 2]\n---\n# A\nbody\n## B\nbody\n# C\nbody\n`;
      const r = parseDeck(md);
      // [1,2] splits at h1 and h2 → A, B, C = 3 slides
      assert.strictEqual(r.slideCount, 3);
    });

    it('honors block-array headingDivider', () => {
      const md = `---\nmarp: true\nheadingDivider:\n  - 1\n  - 2\n---\n# A\nbody\n## B\nbody\n`;
      const r = parseDeck(md);
      // Splits at h1 and h2 → 2 slides
      assert.strictEqual(r.slideCount, 2);
    });
  });

  describe('pickNoteComments', () => {
    it('returns comments matching classifiedNotes in order', () => {
      const comments = [
        { content: 'a1', startLine: 0, endLine: 1 },
        { content: 'a2', startLine: 2, endLine: 3 }
      ];
      const r = pickNoteComments(comments, ['a1', 'a2']);
      assert.strictEqual(r.length, 2);
    });

    it('skips directive-like comments that are not in classifiedNotes', () => {
      const comments = [
        { content: '_class: invert', startLine: 0, endLine: 1 }, // directive
        { content: 'real note', startLine: 2, endLine: 3 }       // note
      ];
      const r = pickNoteComments(comments, ['real note']);
      assert.strictEqual(r.length, 1);
      assert.strictEqual(r[0].content, 'real note');
    });

    it('throws NOT_PARSEABLE when zip ends with mismatched count', () => {
      const comments = [
        { content: 'a', startLine: 0, endLine: 1 }
      ];
      assert.throws(
        () => pickNoteComments(comments, ['a', 'b']),
        (err) => err.code === 'NOT_PARSEABLE'
      );
    });

    it('handles duplicate-content notes via order-preserving zip', () => {
      const comments = [
        { content: 'same', startLine: 0, endLine: 1 },
        { content: 'same', startLine: 2, endLine: 3 }
      ];
      const r = pickNoteComments(comments, ['same', 'same']);
      assert.strictEqual(r.length, 2);
      assert.notStrictEqual(r[0].startLine, r[1].startLine);
    });
  });

  describe('countLines', () => {
    it('counts trailing-newline source as that many lines', () => {
      assert.strictEqual(countLines('a\nb\nc\n'), 3);
    });
    it('counts no-trailing-newline source with +1', () => {
      assert.strictEqual(countLines('a\nb\nc'), 3);
    });
    it('handles CRLF', () => {
      assert.strictEqual(countLines('a\r\nb\r\n'), 2);
    });
    it('returns 0 for empty', () => {
      assert.strictEqual(countLines(''), 0);
    });
  });

  describe('renderDeck (compat for legacy callers)', () => {
    it('returns html, css, slideCount, notes, notesMultiplicity', () => {
      const md = `${FRONTMATTER}# A\n\n<!-- n1 -->\n<!-- n2 -->\n`;
      const r = renderDeck(md);
      assert.ok(r.html);
      assert.ok(r.css);
      assert.strictEqual(r.slideCount, 1);
      assert.strictEqual(r.notes[0], 'n1\n\nn2');
      assert.deepStrictEqual(r.notesMultiplicity, [2]);
    });
  });
});
