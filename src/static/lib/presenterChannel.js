/**
 * Single source of truth for the BroadcastChannel name and message schemas
 * used between the main MDV window and the Presenter window.
 *
 * Imported from a `<script>` tag (no module loader) so we expose globals on
 * `window.MDVPresenterChannel`.
 *
 * Message types (discriminated by `type`):
 *
 *   main → presenter
 *     { type: 'slides', path, html, css, etag, notes, notesMultiplicity, current }
 *     { type: 'slides', empty: true, reason }                    ← clear / no-deck
 *     { type: 'index', index }
 *     { type: 'note-saved', slideIndex, ok, etag?, normalizedNote?, code?, reason? }
 *
 *   presenter → main
 *     { type: 'request-slides' }
 *     { type: 'goto', index }
 *     { type: 'edit-note', path, etag, slideIndex, note }
 */
(function () {
  'use strict';
  const CHANNEL_NAME = 'mdv-marp-presenter';

  function create() {
    if (typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel(CHANNEL_NAME);
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.MDVPresenterChannel = { CHANNEL_NAME, create };
  }
})();
