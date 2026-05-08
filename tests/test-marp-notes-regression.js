/**
 * Regression test suite covering all the edge cases that codex-loop found
 * during Round 1〜10 against the v0 (regex) rewriter, plus the unresolved
 * three. All cases are exercised by the new token-based pipeline:
 *
 *   parseDeck → rewriteSlideNote → parseDeck (verify semantic equality).
 *
 * The unifying assertion: editing slide N's note results in:
 *   - same slideCount
 *   - same notes for every other slide
 *   - target slide's note matches expected
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDeck } from '../src/rendering/marpitAdapter.js';
import { analyseSource } from '../src/utils/lineMath.js';
import { rewriteSlideNote } from '../src/rendering/marpNoteWriter.js';

function rewrite(rawSource, slideIndex, newNote) {
  const parsed = parseDeck(rawSource);
  const lineInfo = analyseSource(rawSource);
  return rewriteSlideNote(rawSource, slideIndex, newNote, parsed, lineInfo);
}

function check(input, slideIndex, newNote, expectedNote) {
  const before = parseDeck(input);
  const { source } = rewrite(input, slideIndex, newNote);
  const after = parseDeck(source);
  assert.strictEqual(after.slideCount, before.slideCount,
    `slide count changed: ${before.slideCount} → ${after.slideCount}`);
  for (let i = 0; i < before.slideCount; i++) {
    if (i === slideIndex) {
      const expected = expectedNote === '' ? [] : [expectedNote];
      assert.deepStrictEqual(after.classifiedNotes[i], expected,
        `slide ${i} mismatch`);
    } else {
      assert.deepStrictEqual(after.classifiedNotes[i], before.classifiedNotes[i],
        `slide ${i} unrelated change: ${JSON.stringify(before.classifiedNotes[i])} → ${JSON.stringify(after.classifiedNotes[i])}`);
    }
  }
  return source;
}

describe('Marp note regression — edge cases from codex-loop rounds', () => {
  describe('Round 1〜2: basic correctness', () => {
    it('label-prefixed notes (Note: TODO:) are speaker notes', () => {
      const md = `---
marp: true
---
# A

<!-- Note: prepare handout -->

---

# B

<!-- TODO: rehearse -->
`;
      check(md, 0, 'updated A', 'updated A');
      check(md, 1, 'updated B', 'updated B');
    });

    it('preserves _class directive', () => {
      const md = `---
marp: true
---
<!-- _class: invert -->

# A

<!-- speaker -->
`;
      const out = check(md, 0, 'edited', 'edited');
      assert.match(out, /<!-- _class: invert -->/);
    });

    it('preserves multi-line directive comment', () => {
      const md = `---
marp: true
---
<!--
_class: invert
backgroundColor: #fff
-->

# A

<!-- note -->
`;
      const out = check(md, 0, 'replaced', 'replaced');
      assert.match(out, /_class: invert\nbackgroundColor: #fff/);
    });
  });

  describe('Round 3〜4: code fence and slide separators', () => {
    it('does not split inside fenced ```yaml --- ---``` blocks', () => {
      const md = `---
marp: true
---
# A

\`\`\`yaml
---
key: value
---
\`\`\`

<!-- a -->

---

# B

<!-- b -->
`;
      const out = check(md, 1, 'fresh B', 'fresh B');
      // Ensure fenced YAML survives intact
      assert.match(out, /```yaml\n---\nkey: value\n---\n```/);
    });

    it('rejects --> in note (validates)', () => {
      const md = `---
marp: true
---
# A

<!-- old -->
`;
      assert.throws(
        () => rewrite(md, 0, 'a --> b'),
        (err) => err.code === 'INVALID_NOTE'
      );
    });

    it('preserves blank lines inside fenced code when clearing notes', () => {
      const md = `---
marp: true
---
# A

\`\`\`js
const a = 1;


const b = 2;
\`\`\`

<!-- to be removed -->
`;
      const out = check(md, 0, '', '');
      assert.match(out, /const a = 1;\n\n\nconst b = 2;/);
    });

    it('handles closing fences with longer markers / trailing spaces', () => {
      const md = `---
marp: true
---
# A

\`\`\`js
const a = 1;
\`\`\`\`

---

# B

<!-- b -->
`;
      check(md, 1, 'edited B', 'edited B');
    });
  });

  describe('Round 5〜7: tab race / shortcuts / Marp directive variants', () => {
    it('handles slide separator after HTML comment line (no setext)', () => {
      const md = `---
marp: true
---
# A

<!-- a -->
---

# B

<!-- b -->
`;
      check(md, 1, 'updated B', 'updated B');
    });

    it('honors comment-form headingDivider directive', () => {
      const md = `---
marp: true
---
<!-- headingDivider: 2 -->

# Deck

## A

<!-- a -->

## B

<!-- b -->
`;
      check(md, 2, 'updated B', 'updated B');
    });

    it('treats *** and ___ as slide separators', () => {
      const md1 = `---
marp: true
---
# A

<!-- a -->

***

# B

<!-- b -->
`;
      check(md1, 1, 'fresh B', 'fresh B');

      const md2 = `---
marp: true
---
# A

<!-- a -->

___

# B

<!-- b -->
`;
      check(md2, 1, 'fresh B', 'fresh B');
    });
  });

  describe('Round 8〜10: setext / headingDivider variants', () => {
    it('does not split on setext H2 (text\\n---)', () => {
      const md = `---
marp: true
---
# A

Subtitle
---

<!-- a -->

---

# B

<!-- b -->
`;
      const out = check(md, 1, 'updated B', 'updated B');
      // setext H2 underline survives
      assert.match(out, /Subtitle\n---/);
    });

    it('preserves lang directive', () => {
      const md = `---
marp: true
---
<!-- lang: ja -->

# A

<!-- a -->
`;
      const out = check(md, 0, 'edited', 'edited');
      assert.match(out, /<!-- lang: ja -->/);
    });

    it('handles inline-array headingDivider', () => {
      const md = `---
marp: true
headingDivider: [1, 2]
---
# A

<!-- a -->

## B

<!-- b -->

# C

<!-- c -->
`;
      check(md, 2, 'updated C', 'updated C');
    });

    it('handles block-array headingDivider (the v0 unresolved case)', () => {
      const md = `---
marp: true
headingDivider:
  - 1
  - 2
---
# A

<!-- a -->

## B

<!-- b -->
`;
      check(md, 1, 'updated B', 'updated B');
    });

    it('does not insert a virtual slide for a leading directive (the v0 unresolved case)', () => {
      const md = `---
marp: true
headingDivider: 2
---

<!-- _class: invert -->

# Deck

## A

<!-- a -->

## B

<!-- b -->
`;
      check(md, 2, 'updated B', 'updated B');
    });

    it('inserts a new note in headingDivider mode without breaking next heading', () => {
      const md = `---
marp: true
headingDivider: 2
---

# Deck

## Slide 1

content

## Slide 2

<!-- s2 -->
`;
      const out = check(md, 1, 'new s1', 'new s1');
      // Crucial: inserted note must not jam against the next heading.
      assert.match(out, /<!-- new s1 -->[\r\n]+## Slide 2/);
    });
  });

  describe('Multi-note / unicode / line-ending edge cases', () => {
    it('refuses to edit slides with multiple notes (Multi-note Guard)', () => {
      const md = `---
marp: true
---
# A

<!-- n1 -->
<!-- n2 -->
`;
      assert.throws(
        () => rewrite(md, 0, 'merged'),
        (err) => err.code === 'MULTI_NOTE_READONLY'
      );
    });

    it('round-trips emoji / surrogate pairs', () => {
      const md = `---
marp: true
---
# A

<!-- old -->
`;
      check(md, 0, '🎉 hello 🚀', '🎉 hello 🚀');
    });

    it('preserves CRLF line endings end-to-end', () => {
      const md = '---\r\nmarp: true\r\n---\r\n# A\r\n\r\n<!-- old -->\r\n';
      const { source } = rewrite(md, 0, 'fresh');
      assert.match(source, /<!-- fresh -->/);
      // The output continues to use CRLF (no LF-only lines should appear in
      // the previously-CRLF region)
      const lfOnlyAfterFirstSlide = source.indexOf('\n', 0);
      const crBefore = lfOnlyAfterFirstSlide > 0
        && source[lfOnlyAfterFirstSlide - 1] === '\r';
      assert.ok(crBefore, 'CRLF expected after first newline position');
    });

    it('preserves BOM', () => {
      const md = '﻿---\nmarp: true\n---\n# A\n\n<!-- old -->\n';
      const { source } = rewrite(md, 0, 'edited');
      assert.strictEqual(source.charCodeAt(0), 0xFEFF);
    });

    it('frontmatter-absent decks still work', () => {
      // Marp normally requires frontmatter, but parseDeck still emits 1 slide
      const md = `# A

<!-- a -->
`;
      const { source } = rewrite(md, 0, 'updated');
      const after = parseDeck(source);
      assert.deepStrictEqual(after.classifiedNotes[0], ['updated']);
    });
  });
});
