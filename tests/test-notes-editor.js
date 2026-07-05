/**
 * Tests for src/static/lib/notesEditor.js — pure JS, no DOM required.
 *
 * isNotesEditable() is a plain boolean predicate and is fully covered here.
 * readEditableText() walks a real DOM (`Node.TEXT_NODE` / `Node.ELEMENT_NODE`
 * come from the global `Node` class, which only exists in a browser), so it
 * is NOT unit-tested here — it's covered by the Playwright E2E suite
 * (marp-preview / inline-notes autosave specs) that exercises it against
 * real contenteditable DOM in app.js and presenter.html.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isNotesEditable } from '../src/static/lib/notesEditor.js';

describe('notesEditor — isNotesEditable truth table', () => {
  it('is NOT editable when the deck has no etag (GET degrade / unparseable), regardless of multiplicity', () => {
    assert.strictEqual(isNotesEditable(false, 0), false);
    assert.strictEqual(isNotesEditable(false, 1), false);
    assert.strictEqual(isNotesEditable(false, 2), false);
  });

  it('is editable when hasEtag is true and multiplicity is 0 or 1', () => {
    assert.strictEqual(isNotesEditable(true, 0), true);
    assert.strictEqual(isNotesEditable(true, 1), true);
  });

  it('is NOT editable when hasEtag is true but multiplicity is greater than 1', () => {
    assert.strictEqual(isNotesEditable(true, 2), false);
    assert.strictEqual(isNotesEditable(true, 5), false);
  });

  it('mirrors presenter.html isReadOnlyForCurrent()\'s original truth table under negation', () => {
    // presenter.html used to compute:
    //   isReadOnlyForCurrent = !deckEtag || (typeof m === 'number' && m > 1)
    // isNotesEditable(hasEtag, m) = hasEtag && m <= 1
    // so isReadOnlyForCurrent === !isNotesEditable(hasEtag, m) for every
    // (hasEtag, m) pair that occurs in practice.
    const cases = [
      { hasEtag: false, m: 0, readOnly: true },
      { hasEtag: false, m: 2, readOnly: true },
      { hasEtag: true, m: 0, readOnly: false },
      { hasEtag: true, m: 1, readOnly: false },
      { hasEtag: true, m: 2, readOnly: true },
    ];
    for (const { hasEtag, m, readOnly } of cases) {
      assert.strictEqual(!isNotesEditable(hasEtag, m), readOnly,
        `hasEtag=${hasEtag} m=${m}`);
    }
  });
});
