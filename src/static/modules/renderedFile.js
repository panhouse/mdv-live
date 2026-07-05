/**
 * MDV - Rendered File SSOT (Stage 3f, audit item P2)
 *
 * The server's "rendered file" envelope — the JSON body of GET /api/file,
 * and the same shape spread into the websocket's `file_update` broadcast
 * (see src/watcher.js) — carries a fixed set of fields:
 *
 *   content, raw, fileType, isMarp, css, notes, notesMultiplicity, etag,
 *   lineEnding, hasBom
 *
 * (see src/rendering/index.js renderFile()/renderMarkdownFile(): css/
 * notes/notesMultiplicity/lineEnding/hasBom are present ONLY when the file
 * is a Marp deck; isMarp is present only for markdown files at all;
 * content/raw/fileType are absent from the binary-file JSON shape built by
 * src/api/file.js buildBinaryFileResponse()).
 *
 * `etag` used to be on that Marp-only list too, but is universal as of
 * 0.6.4: BOTH the `file_update` broadcast (src/watcher.js, since 0.6.3)
 * AND GET /api/file (src/rendering/index.js renderFile(), since the 0.6.4
 * codex round-7 fix) carry a raw-content-hash `etag` for every
 * markdown/code/text envelope — a hash that only sometimes refreshed let
 * diffReview's fast path trust a stale value and hide real changes.
 * **Never use etag-presence as a Marp-detection proxy** —
 * check `isMarp` instead. (modules/diffReview.js's baseline-hash lookup
 * still calls `MDVApi.diff(path, '')`'s `currentHash` for exactly this
 * gap, rather than trusting `tab.etag` to always be populated.)
 *
 * Before this module, 4 call sites re-destructured this envelope onto a
 * `tab` object with 4 subtly different truthy/typeof/Array.isArray guards:
 *   1. modules/websocket.js  handleFileUpdate()      (live file_update)
 *   2. modules/tabs.js       TabManager.open()        (new-tab constructor)
 *   3. modules/editor.js     EditorManager.hide()      (editor-refresh)
 *   4. modules/editor.js     EditorManager.save()      (post-save refresh)
 * See docs/refactoring-2026-07-strategy.md Stage 3f task notes for the
 * exact before/after guard at each site.
 *
 * applyRenderedFile() is now the one place that knows the field list and
 * the guard for each field:
 *
 *   field              guard for "is this field present in `data`?"
 *   -----------------  --------------------------------------------
 *   content            typeof data.content === 'string'
 *   raw                typeof data.raw === 'string'
 *   fileType           typeof data.fileType === 'string'
 *   isMarp             typeof data.isMarp !== 'undefined'
 *   css                !!data.css
 *   notes              Array.isArray(data.notes)
 *   notesMultiplicity  Array.isArray(data.notesMultiplicity)
 *   etag               !!data.etag
 *   lineEnding         !!data.lineEnding
 *   hasBom             typeof data.hasBom !== 'undefined' (coerced via !!)
 *
 * Two call shapes:
 *   - applyRenderedFile(tab, data) — UPDATE mode. Only fields actually
 *     present in `data` are copied onto `tab`; an absent field is left
 *     untouched (this is what all 3 "refresh an existing tab" sites need).
 *   - applyRenderedFile(tab, data, { withDefaults: true }) — CREATE mode.
 *     Same guards, but a field absent from `data` gets the tab's default
 *     (matching TabManager.open()'s original object-literal fallbacks —
 *     `isMarp: false`, `css: null`, `notes: []`, `notesMultiplicity: []`,
 *     `etag: null`, `lineEnding: '\n'`, `hasBom: false`) instead of being
 *     skipped. content/raw/fileType have no default — CREATE mode assigns
 *     `data[key]` unconditionally for those three, exactly like the
 *     original unguarded `content: data.content, raw: data.raw,
 *     fileType: data.fileType` object-literal fields (so a binary tab,
 *     whose JSON has neither, still gets `content: undefined` etc., same
 *     as before).
 *
 * Returns `tab` for convenient chaining (e.g.
 * `state.tabs.push(applyRenderedFile({...}, data, {withDefaults:true}))`).
 */

const FIELDS = [
  { key: 'content', present: (d) => typeof d.content === 'string' },
  { key: 'raw', present: (d) => typeof d.raw === 'string' },
  { key: 'fileType', present: (d) => typeof d.fileType === 'string' },
  { key: 'isMarp', present: (d) => typeof d.isMarp !== 'undefined', fallback: false },
  { key: 'css', present: (d) => !!d.css, fallback: null },
  { key: 'notes', present: (d) => Array.isArray(d.notes), fallback: [] },
  { key: 'notesMultiplicity', present: (d) => Array.isArray(d.notesMultiplicity), fallback: [] },
  { key: 'etag', present: (d) => !!d.etag, fallback: null },
  { key: 'lineEnding', present: (d) => !!d.lineEnding, fallback: '\n' },
  {
    key: 'hasBom',
    present: (d) => typeof d.hasBom !== 'undefined',
    fallback: false,
    coerce: (v) => !!v
  }
];

/**
 * Apply the server's rendered-file envelope onto `tab`.
 * @param {object} tab - Tab object to mutate (or a fresh object literal
 *   under construction, in CREATE mode).
 * @param {object} data - The rendered-file envelope (GET /api/file JSON,
 *   or a file_update broadcast payload).
 * @param {{ withDefaults?: boolean }} [opts] - Pass `{ withDefaults: true }`
 *   when building a brand-new tab so absent Marp-only fields get their
 *   default instead of being skipped.
 * @returns {object} `tab`, mutated in place.
 */
export function applyRenderedFile(tab, data, { withDefaults = false } = {}) {
  for (const field of FIELDS) {
    const { key, present, coerce } = field;
    if (present(data)) {
      tab[key] = coerce ? coerce(data[key]) : data[key];
    } else if (withDefaults) {
      tab[key] = 'fallback' in field ? field.fallback : data[key];
    }
  }
  return tab;
}
