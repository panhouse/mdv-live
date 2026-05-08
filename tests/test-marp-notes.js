/**
 * Tests for Marp speaker-notes extraction.
 *
 * Marp Core returns HTML comments per slide via `marp.render().comments`.
 * Our renderMarp() flattens this into a `notes` array (one entry per slide).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderMarp } from '../src/rendering/marp.js';

const FRONTMATTER = '---\nmarp: true\n---\n';

describe('Marp Notes Extraction', () => {
  it('returns one note per slide, in slide order', () => {
    const md = `${FRONTMATTER}
# Slide 1

<!-- first slide note -->

---

# Slide 2

<!-- second slide note -->

---

# Slide 3
`;
    const { slideCount, notes } = renderMarp(md);

    assert.strictEqual(slideCount, 3);
    assert.strictEqual(notes.length, 3);
    assert.strictEqual(notes[0], 'first slide note');
    assert.strictEqual(notes[1], 'second slide note');
    assert.strictEqual(notes[2], '');
  });

  it('joins multiple comments on a single slide with blank lines', () => {
    const md = `${FRONTMATTER}
# Slide 1

<!-- line one -->

<!-- line two -->
`;
    const { notes } = renderMarp(md);

    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0], 'line one\n\nline two');
  });

  it('returns empty strings when no comments are present', () => {
    const md = `${FRONTMATTER}
# Slide 1

---

# Slide 2
`;
    const { slideCount, notes } = renderMarp(md);

    assert.strictEqual(slideCount, 2);
    assert.deepStrictEqual(notes, ['', '']);
  });
});
