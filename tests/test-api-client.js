/**
 * Tests for src/static/lib/apiClient.js — the browser-side HTTP client.
 *
 * Stubs `globalThis.fetch` and asserts each MDVApi function builds the
 * right URL / method / headers / body, and handles the response the same
 * way the pre-existing app.js call sites relied on (parsed-JSON + throw on
 * `{error}`/`{detail}` for the mkdir/move/delete family; raw Response for
 * the tree/file/shutdown/raw-css family).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as MDVApi from '../src/static/lib/apiClient.js';

function fakeResponse({ ok = true, status = 200, json = {}, brokenJson = false } = {}) {
  return {
    ok,
    status,
    json: async () => {
      if (brokenJson) throw new SyntaxError('Unexpected end of JSON input');
      return json;
    },
    text: async () => JSON.stringify(json)
  };
}

/** Installs a fetch stub that records every call and returns `response`. */
function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return typeof response === 'function' ? response(url, options) : response;
  };
  return calls;
}

describe('apiClient — MDVApi HTTP conventions', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchTree() GETs /api/tree with no extra options', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.fetchTree();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/tree');
    assert.equal(calls[0].options, undefined);
  });

  it('expandTree(path) GETs /api/tree/expand with an encoded path param', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.expandTree('a/b c');
    assert.equal(calls[0].url, '/api/tree/expand?path=' + encodeURIComponent('a/b c'));
  });

  it('pageTree(path, offset) omits limit when not given', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.pageTree('docs', 5);
    assert.equal(calls[0].url, '/api/tree/page?path=docs&offset=5');
  });

  it('pageTree(path, offset, limit) includes limit', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.pageTree('a/b', 10, 50);
    assert.equal(calls[0].url, '/api/tree/page?path=a%2Fb&offset=10&limit=50');
  });

  it('pageTree() defaults path to "" and offset to 0', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.pageTree();
    assert.equal(calls[0].url, '/api/tree/page?path=&offset=0');
  });

  it('fetchFile(path) GETs /api/file with an encoded path param', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.fetchFile('a/b.md');
    assert.equal(calls[0].url, '/api/file?path=' + encodeURIComponent('a/b.md'));
  });

  it('saveFile(path, content, signal) POSTs JSON with the abort signal', async () => {
    const calls = stubFetch(fakeResponse());
    const controller = new AbortController();
    await MDVApi.saveFile('a.md', 'hello', controller.signal);
    assert.equal(calls[0].url, '/api/file');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' });
    assert.equal(calls[0].options.body, JSON.stringify({ path: 'a.md', content: 'hello' }));
    assert.equal(calls[0].options.signal, controller.signal);
  });

  it('fetchInfo() GETs /api/info', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.fetchInfo();
    assert.equal(calls[0].url, '/api/info');
  });

  it('exportPdf(payload) POSTs the payload as JSON', async () => {
    const calls = stubFetch(fakeResponse());
    const payload = { filePath: 'a.md', format: 'A4' };
    await MDVApi.exportPdf(payload);
    assert.equal(calls[0].url, '/api/pdf/export');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' });
    assert.equal(calls[0].options.body, JSON.stringify(payload));
  });

  it('getDeck(path) GETs /api/marp/decks/:path and returns { res, data }', async () => {
    const calls = stubFetch(fakeResponse({ json: { slides: 3 } }));
    const { res, data } = await MDVApi.getDeck('deck.md');
    assert.equal(calls[0].url, '/api/marp/decks/' + encodeURIComponent('deck.md'));
    assert.equal(calls[0].options, undefined);
    assert.deepEqual(data, { slides: 3 });
    assert.equal(res.ok, true);
  });

  it('getDeck(path) falls back to {} when the body is not valid JSON', async () => {
    stubFetch(fakeResponse({ brokenJson: true }));
    const { data } = await MDVApi.getDeck('deck.md');
    assert.deepEqual(data, {});
  });

  it('saveMarpNote(path, slideIndex, note, ifMatch) PUTs with If-Match', async () => {
    const calls = stubFetch(fakeResponse({ json: { ok: true } }));
    const { data } = await MDVApi.saveMarpNote('deck.md', 2, 'note text', '"etag123"');
    assert.equal(
      calls[0].url,
      '/api/marp/decks/' + encodeURIComponent('deck.md') + '/slides/2/note'
    );
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(calls[0].options.headers, {
      'Content-Type': 'application/json',
      'If-Match': '"etag123"'
    });
    assert.equal(calls[0].options.body, JSON.stringify({ note: 'note text' }));
    assert.deepEqual(data, { ok: true });
  });

  it('mkdir(path) POSTs /api/mkdir and resolves with the parsed body', async () => {
    const calls = stubFetch(fakeResponse({ json: { success: true } }));
    const result = await MDVApi.mkdir('new/dir');
    assert.equal(calls[0].url, '/api/mkdir');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' });
    assert.equal(calls[0].options.body, JSON.stringify({ path: 'new/dir' }));
    assert.deepEqual(result, { success: true });
  });

  it('mkdir(path) throws when the response body carries an error field', async () => {
    stubFetch(fakeResponse({ json: { error: 'EEXIST' } }));
    await assert.rejects(() => MDVApi.mkdir('dup'), /EEXIST/);
  });

  it('mkdir(path) throws when the response body carries a detail field', async () => {
    stubFetch(fakeResponse({ json: { detail: 'bad path' } }));
    await assert.rejects(() => MDVApi.mkdir('..'), /bad path/);
  });

  it('moveItem(source, destination) POSTs /api/move with both paths', async () => {
    const calls = stubFetch(fakeResponse({ json: { success: true } }));
    const result = await MDVApi.moveItem('a.md', 'b/a.md');
    assert.equal(calls[0].url, '/api/move');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body, JSON.stringify({ source: 'a.md', destination: 'b/a.md' }));
    assert.deepEqual(result, { success: true });
  });

  it('deleteFile(path) sends DELETE /api/file with an encoded path param', async () => {
    const calls = stubFetch(fakeResponse({ json: { success: true } }));
    await MDVApi.deleteFile('a b.md');
    assert.equal(calls[0].url, '/api/file?path=' + encodeURIComponent('a b.md'));
    assert.equal(calls[0].options.method, 'DELETE');
  });

  it('deleteFile(path) throws on an error-shaped response', async () => {
    stubFetch(fakeResponse({ json: { error: 'ENOENT' } }));
    await assert.rejects(() => MDVApi.deleteFile('missing.md'), /ENOENT/);
  });

  it('shutdown() POSTs /api/shutdown and does not parse the response', async () => {
    const sentinel = fakeResponse({ ok: false });
    const calls = stubFetch(sentinel);
    const result = await MDVApi.shutdown();
    assert.equal(calls[0].url, '/api/shutdown');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers, undefined);
    // Not parsed: the raw response comes back untouched (callers swallow
    // connection failures themselves as the server disappears mid-request).
    assert.equal(result, sentinel);
  });

  it('fetchRawCss(path) GETs /raw/:path without encoding', async () => {
    const calls = stubFetch(fakeResponse());
    await MDVApi.fetchRawCss('styles/report.css');
    assert.equal(calls[0].url, '/raw/styles/report.css');
    assert.equal(calls[0].options, undefined);
  });
});
