/**
 * Tests for the speaker-note rewriter used by the Presenter View.
 *
 * The rewriter modifies the source markdown so that edits made in the
 * Presenter window persist to disk. Marp directive comments
 * (`<!-- _class: invert -->`) MUST NOT be touched.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// The rewriter is a browser-targeted classic script, so load it into an
// isolated VM context and grab the global it publishes.
const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(here, '..', 'src', 'static', 'marpNoteRewriter.js'), 'utf-8');
const sandbox = vm.createContext({});
vm.runInContext(code, sandbox);
const { updateMarpNoteInRaw } = sandbox.MarpNoteRewriter;

const FRONTMATTER = '---\nmarp: true\n---\n';

describe('updateMarpNoteInRaw', () => {
  it('replaces an existing speaker-note comment in the target slide', () => {
    const raw = `${FRONTMATTER}
# Slide 1

<!-- old note -->

---

# Slide 2

<!-- second note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'fresh note');
    assert.match(out, /<!-- fresh note -->/);
    assert.doesNotMatch(out, /old note/);
    // Untouched slide 2 keeps its note.
    assert.match(out, /<!-- second note -->/);
  });

  it('appends a new comment when the slide has no speaker note yet', () => {
    const raw = `${FRONTMATTER}
# Slide 1

content here

---

# Slide 2
`;
    const out = updateMarpNoteInRaw(raw, 0, 'newly added');
    assert.match(out, /<!-- newly added -->/);
    // Slide separator preserved.
    assert.match(out, /\n---\n/);
  });

  it('removes the speaker-note comment when the new note is empty', () => {
    const raw = `${FRONTMATTER}
# Slide 1

<!-- to be deleted -->

---

# Slide 2
`;
    const out = updateMarpNoteInRaw(raw, 0, '');
    assert.doesNotMatch(out, /to be deleted/);
    assert.doesNotMatch(out, /<!--[^]*?-->/);
  });

  it('preserves Marp directive comments when editing notes', () => {
    const raw = `${FRONTMATTER}
<!-- _class: invert -->

# Slide 1

<!-- old speaker note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'updated speaker note');
    assert.match(out, /<!-- _class: invert -->/);
    assert.match(out, /<!-- updated speaker note -->/);
    assert.doesNotMatch(out, /old speaker note/);
  });

  it('uses a multi-line block format when the note contains newlines', () => {
    const raw = `${FRONTMATTER}
# Slide 1
`;
    const out = updateMarpNoteInRaw(raw, 0, 'line one\nline two');
    assert.match(out, /<!--\nline one\nline two\n-->/);
  });

  it('returns the original markdown when slideIndex is out of range', () => {
    const raw = `${FRONTMATTER}
# Slide 1
`;
    assert.strictEqual(updateMarpNoteInRaw(raw, 5, 'x'), raw);
    assert.strictEqual(updateMarpNoteInRaw(raw, -1, 'x'), raw);
  });

  it('treats label-prefixed comments like "Note:" / "TODO:" as speaker notes, not directives', () => {
    // marp-core returns these as speaker notes — the rewriter must follow
    // suit so that editing or clearing them works as expected.
    const raw = `${FRONTMATTER}
# Slide 1

<!-- Note: prepare demo handout -->

---

# Slide 2

<!-- TODO: rehearse this part -->
`;
    const cleared = updateMarpNoteInRaw(raw, 0, '');
    assert.doesNotMatch(cleared, /Note: prepare demo handout/);

    const replaced = updateMarpNoteInRaw(raw, 1, 'fully scripted now');
    assert.doesNotMatch(replaced, /TODO: rehearse this part/);
    assert.match(replaced, /<!-- fully scripted now -->/);
  });

  it('collapses multiple speaker-note comments into a single canonical comment', () => {
    // Marp flattens multiple comments into one editable string, so the saved
    // markdown must end up with exactly one comment — otherwise the user's
    // original fragments resurface on reload.
    const raw = `${FRONTMATTER}
# Slide 1

<!-- first piece of note -->

some content

<!-- second piece of note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'unified note');
    assert.doesNotMatch(out, /first piece of note/);
    assert.doesNotMatch(out, /second piece of note/);
    const matches = out.match(/<!--[\s\S]*?-->/g) || [];
    assert.strictEqual(matches.length, 1);
    assert.match(out, /<!-- unified note -->/);
  });

  it('keeps multi-line directive comments untouched', () => {
    const raw = `${FRONTMATTER}
<!--
_class: invert
backgroundColor: #fff
-->

# Slide 1

<!-- speaker note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'replaced');
    assert.match(out, /_class: invert\nbackgroundColor: #fff/);
    assert.match(out, /<!-- replaced -->/);
    assert.doesNotMatch(out, /speaker note/);
  });

  it('treats `---` inside a fenced code block as content, not a slide break', () => {
    // The yaml block in slide 1 contains `---` lines that look like slide
    // separators. Marp does not split on them, so the rewriter must not
    // either — otherwise editing the speaker note for slide 2 lands in
    // slide 1's code block.
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`yaml
---
key: value
---
\`\`\`

<!-- slide 1 note -->

---

# Slide 2

<!-- slide 2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 1, 'edited slide 2 note');
    // Slide 1 note untouched
    assert.match(out, /<!-- slide 1 note -->/);
    // Slide 2 note replaced
    assert.match(out, /<!-- edited slide 2 note -->/);
    assert.doesNotMatch(out, /slide 2 note(?! -->)/);
    // The yaml fence content survives intact
    assert.match(out, /```yaml\n---\nkey: value\n---\n```/);
  });

  it('rejects notes whose content would close the HTML comment', () => {
    const raw = `${FRONTMATTER}
# Slide 1

<!-- old note -->
`;
    assert.throws(
      () => updateMarpNoteInRaw(raw, 0, 'a --> b'),
      /cannot contain "-->"/
    );
    assert.throws(
      () => updateMarpNoteInRaw(raw, 0, 'a --!> b'),
      /cannot contain "--!>"/
    );
    assert.throws(
      () => updateMarpNoteInRaw(raw, 0, 'trailing --'),
      /cannot end with "--"/
    );
  });

  it('preserves blank lines inside fenced code blocks when clearing notes', () => {
    // Removing the speaker note must not collapse the user's intentional
    // blank lines inside a fenced code block in the same slide.
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`js
const a = 1;


const b = 2;
\`\`\`

<!-- note to remove -->
`;
    const out = updateMarpNoteInRaw(raw, 0, '');
    assert.doesNotMatch(out, /note to remove/);
    assert.match(out, /const a = 1;\n\n\nconst b = 2;/);
  });

  it('does not touch HTML comments inside fenced code blocks', () => {
    // The fenced sample comment must survive unchanged when editing the
    // slide's actual speaker note.
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`html
<div>
  <!-- keep this sample comment -->
</div>
\`\`\`

<!-- the real note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'edited note');
    assert.match(out, /<!-- keep this sample comment -->/);
    assert.match(out, /<!-- edited note -->/);
    assert.doesNotMatch(out, /the real note/);
  });

  it('clears the right note when fenced code blocks contain HTML comments', () => {
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`html
<!-- code sample -->
\`\`\`

<!-- speaker note to clear -->
`;
    const out = updateMarpNoteInRaw(raw, 0, '');
    assert.match(out, /<!-- code sample -->/);
    assert.doesNotMatch(out, /speaker note to clear/);
  });

  it('treats heading-based slide breaks (headingDivider) as separators', () => {
    const raw = `---
marp: true
headingDivider: 2
---

# Deck

## Slide 1

<!-- s1 note -->

## Slide 2

<!-- s2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 2, 'updated s2');
    // Slides indexed: 0=cover (`# Deck` until `## Slide 1`), 1=Slide 1, 2=Slide 2.
    assert.match(out, /<!-- s1 note -->/);
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
  });

  it('treats closing fences with trailing spaces or longer markers as fence ends', () => {
    // CommonMark allows the closer to be longer than the opener and to have
    // trailing spaces. A naive equality check would keep us "inside" the
    // fence, so the next `---` slide separator would be ignored and slide 2
    // edits would silently miss.
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`js
const a = 1;
\`\`\`\`

---

# Slide 2

<!-- s2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 1, 'edited s2');
    assert.match(out, /<!-- edited s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
  });

  it('does not insert a virtual slide for a leading directive comment under headingDivider', () => {
    // Marp does not emit an extra slide for `<!-- _class: invert -->` before
    // the first heading; the rewriter must follow suit, otherwise indices
    // shift by one and slide 2 edits land on slide 1.
    const raw = `---
marp: true
headingDivider: 2
---

<!-- _class: invert -->

# Deck

## Slide1

<!-- s1 -->

## Slide2

<!-- s2 -->
`;
    const out = updateMarpNoteInRaw(raw, 2, 'updated s2');
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 -->/);
    assert.match(out, /<!-- s1 -->/);
  });

  it('honors comment-form headingDivider directives', () => {
    const raw = `---
marp: true
---

<!-- headingDivider: 2 -->

# Deck

## Slide1

<!-- s1 note -->

## Slide2

<!-- s2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 2, 'updated s2');
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
  });

  it('treats `***` and `___` thematic breaks as slide separators', () => {
    const raw1 = `${FRONTMATTER}
# Slide 1

<!-- s1 -->

***

# Slide 2

<!-- old s2 -->
`;
    const out1 = updateMarpNoteInRaw(raw1, 1, 'fresh s2');
    assert.match(out1, /<!-- fresh s2 -->/);
    assert.doesNotMatch(out1, /<!-- old s2 -->/);

    const raw2 = `${FRONTMATTER}
# Slide 1

<!-- s1 -->

___

# Slide 2

<!-- old s2 -->
`;
    const out2 = updateMarpNoteInRaw(raw2, 1, 'fresh s2');
    assert.match(out2, /<!-- fresh s2 -->/);
    assert.doesNotMatch(out2, /<!-- old s2 -->/);
  });

  it('does not split on a setext H2 underline (--- right under text)', () => {
    // `Subtitle\n---` is a level-2 heading, not a thematic break. Splitting
    // on it would land slide-2 edits inside the wrong segment.
    const raw = `${FRONTMATTER}
# Slide 1

Subtitle
---

<!-- s1 note -->

---

# Slide 2

<!-- s2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 1, 'updated s2');
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
    assert.match(out, /<!-- s1 note -->/);
    // The setext underline survives.
    assert.match(out, /Subtitle\n---/);
  });

  it('preserves the lang directive when saving a note', () => {
    const raw = `${FRONTMATTER}
<!-- lang: ja -->

# Slide 1

<!-- speaker note -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'edited');
    assert.match(out, /<!-- lang: ja -->/);
    assert.match(out, /<!-- edited -->/);
  });

  it('supports array-form headingDivider directive', () => {
    const raw = `---
marp: true
headingDivider: [1, 2]
---

# Slide A

<!-- a -->

## Slide B

<!-- b -->

# Slide C

<!-- c -->
`;
    // With [1, 2] the deck has 3 slides: A, B, C.
    const out = updateMarpNoteInRaw(raw, 2, 'updated c');
    assert.match(out, /<!-- updated c -->/);
    assert.doesNotMatch(out, /<!-- c -->/);
  });

  it('preserves a newline before the next heading when adding a note in headingDivider mode', () => {
    const raw = `---
marp: true
headingDivider: 2
---

# Deck

## Slide 1

content

## Slide 2

<!-- s2 -->
`;
    const out = updateMarpNoteInRaw(raw, 1, 'new s1');
    // Critical: the inserted note must not jam against the next heading,
    // otherwise Marp stops recognising the slide split.
    assert.match(out, /<!-- new s1 -->\n+## Slide 2/);
  });

  it('treats `---` after an HTML comment line as a slide separator (not setext)', () => {
    // No blank line between `<!-- ... -->` and `---`. The previous line is
    // an HTML block (not a paragraph), so the `---` is a thematic break.
    const raw = `${FRONTMATTER}
# Slide 1

<!-- s1 note -->
---

# Slide 2

<!-- s2 note -->
`;
    const out = updateMarpNoteInRaw(raw, 1, 'updated s2');
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
    // Slide 1 untouched.
    assert.match(out, /<!-- s1 note -->/);
  });

  it('ignores headingDivider directives inside fenced code blocks', () => {
    const raw = `${FRONTMATTER}
# Slide 1

\`\`\`html
<!-- headingDivider: 2 -->
\`\`\`

<!-- s1 note -->

---

# Slide 2

## sub

<!-- s2 note -->
`;
    // The fenced sample must NOT activate heading-divider, so slide 2 is
    // still index 1 (no virtual split for `## sub`).
    const out = updateMarpNoteInRaw(raw, 1, 'updated s2');
    assert.match(out, /<!-- updated s2 -->/);
    assert.doesNotMatch(out, /<!-- s2 note -->/);
  });

  it('does not modify front matter even when it contains --- separators', () => {
    const raw = `---
marp: true
title: "uses --- in metadata"
---

# Slide 1

<!-- old -->
`;
    const out = updateMarpNoteInRaw(raw, 0, 'new');
    assert.match(out, /title: "uses --- in metadata"/);
    assert.match(out, /<!-- new -->/);
  });
});
