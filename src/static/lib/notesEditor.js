/**
 * DOM-parameter-only helpers for the Marp speaker-notes editors.
 *
 * readEditableText(el) used to be duplicated byte-for-byte in app.js's
 * InlineNotesPanel (~line 990-1009) and presenter.html's inline module
 * script (~line 343-360) — audit P1. isNotesEditable(hasEtag,
 * notesMultiplicity) encodes the "can this slide's notes be edited" rule
 * that was previously implemented twice with inverted polarity: app.js's
 * InlineNotesPanel.buildPanel computed `canEdit = hasEtag && multiplicity
 * <= 1`, while presenter.html's isReadOnlyForCurrent computed the negation
 * ad hoc (`!deckEtag` / `multiplicity > 1`) — audit P2.
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also still sets
 * `globalThis.MDVNotesEditor` for any not-yet-migrated code that reads the
 * global directly.
 */

// contenteditable inserts <div>/<br> nodes for line breaks; textContent
// flattens those without separators. Walk the DOM and emit \n at block
// boundaries so two-line edits arrive as `line1\nline2`. Mirrors the
// implementation that used to live independently in app.js and
// presenter.html.
function readEditableText(el) {
  let out = '';
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    const isBlock = tag === 'DIV' || tag === 'P' || tag === 'LI';
    if (isBlock && out && !out.endsWith('\n')) out += '\n';
    for (const child of node.childNodes) walk(child);
    if (isBlock && !out.endsWith('\n')) out += '\n';
  }
  for (const child of el.childNodes) walk(child);
  return out.replace(/\n+$/, '');
}

// A slide's speaker notes are editable iff the deck has a live etag (i.e.
// it isn't in GET-degrade / unparseable) AND the slide doesn't merge more
// than one raw HTML comment (multiplicity <= 1 — a single contenteditable
// can't losslessly round-trip more than one comment, so those slides are
// edited via the markdown editor instead).
function isNotesEditable(hasEtag, notesMultiplicity) {
  return hasEtag && notesMultiplicity <= 1;
}

export { readEditableText, isNotesEditable };

if (typeof globalThis !== 'undefined') {
  globalThis.MDVNotesEditor = { readEditableText, isNotesEditable };
}
