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

  // --- Other MDV endpoints used throughout the app -------------------------

  function fetchTree() { return fetch('/api/tree'); }
  function expandTree(path) {
    return fetch('/api/tree/expand?path=' + encodeURIComponent(path));
  }
  /** GET /api/tree/page — next page of a large directory's children */
  function pageTree(path, offset, limit) {
    const params = new URLSearchParams({ path: path || '', offset: String(offset || 0) });
    if (limit) params.set('limit', String(limit));
    return fetch('/api/tree/page?' + params.toString());
  }
  function fetchFile(path) {
    return fetch('/api/file?path=' + encodeURIComponent(path));
  }
  function saveFile(path, content, signal) {
    return fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
      signal
    });
  }
  function fetchInfo() { return fetch('/api/info'); }
  function exportPdf(payload) {
    return fetch('/api/pdf/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.MDVApi = {
      getDeck,
      saveMarpNote,
      fetchTree,
      expandTree,
      pageTree,
      fetchFile,
      saveFile,
      fetchInfo,
      exportPdf
    };
  }
})();
