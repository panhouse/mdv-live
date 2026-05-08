/**
 * Thin HTTP client used by the main MDV window.
 *
 * Centralizes URL construction, common headers (If-Match), JSON parsing, and
 * error normalization. Loaded as a classic `<script>` so the API is exposed
 * on `window.MDVApi`.
 */
(function () {
  'use strict';

  async function jsonOrEmpty(res) {
    try { return await res.json(); } catch { return {}; }
  }

  /** GET /api/marp/decks/:path */
  async function getDeck(path) {
    const res = await fetch('/api/marp/decks/' + encodeURIComponent(path));
    return { res, data: await jsonOrEmpty(res) };
  }

  /** PUT /api/marp/decks/:path/slides/:N/note (If-Match required) */
  async function saveMarpNote(path, slideIndex, note, ifMatch) {
    const url = '/api/marp/decks/' + encodeURIComponent(path)
      + '/slides/' + slideIndex + '/note';
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': ifMatch
      },
      body: JSON.stringify({ note })
    });
    return { res, data: await jsonOrEmpty(res) };
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.MDVApi = { getDeck, saveMarpNote };
  }
})();
