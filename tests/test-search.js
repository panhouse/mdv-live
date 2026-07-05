/**
 * src/services/search.js (engine, direct/no-server) + src/api/search.js
 * (GET /api/search, via a real server through tests/helpers/server.js).
 *
 * Covers:
 *  - literal match with correct path/line/col/snippet
 *  - ignore-list parity with the tree (node_modules, dotfile dirs)
 *  - >SEARCH_MAX_FILE_BYTES files skipped entirely
 *  - non-markdown/code/text (binary) files skipped by type, not content-sniffed
 *  - multibyte (Japanese) content: correct line/col
 *  - smart-case both directions
 *  - snippet clipping (long lines) and non-clipping (short lines)
 *  - truncation at the requested limit, and the hard SEARCH_MAX_RESULTS cap
 *    regardless of a caller-requested limit above it
 *  - empty query is a no-op, not a full-tree scan
 *  - HTTP layer: 400 SEARCH_QUERY_REQUIRED (missing/empty/too-long q), limit
 *    clamping, no Origin/Host guard (read-only GET), response shape
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { searchFiles } from '../src/services/search.js';
import { SEARCH_MAX_FILE_BYTES, SEARCH_MAX_RESULTS, SEARCH_QUERY_MAX_LENGTH } from '../src/config/constants.js';
import { startTestServer } from './helpers/server.js';

/** Write a flat `{ relativePath: content }` map into rootDir (mirrors helpers/server.js's private seedFiles). */
async function seed(rootDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

describe('services/search.js — searchFiles() (direct, no server)', () => {
  let rootDir;

  before(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-search-'));
    await seed(rootDir, {
      'top.md': 'alpha BASICHIT beta\n',
      'node_modules/hit.md': 'NODEMODULESHIT should not appear\n',
      '.hidden/secret.md': 'HIDDENHIT should not appear\n',
      'docs/sub/nested.md': 'NESTEDHIT here\n',
      'huge.md': `${'A'.repeat(SEARCH_MAX_FILE_BYTES + 100)} HUGEHIT\n`,
      'image.png': Buffer.concat([Buffer.from('binary '), Buffer.from([0, 1, 2, 3]), Buffer.from(' PNGHIT data')]),
      'jp/quote.md': ['# タイトル', 'これは見積です', '見積の内容'].join('\n'),
      'case.txt': ['Hello World', 'hello there', 'HELLO ALL CAPS'].join('\n'),
      'long-line.md': `${'x'.repeat(150)}CLIPHIT${'y'.repeat(150)}`,
      'short-line.md': 'a short SNIPHIT line',
      'many.md': Array.from({ length: 10 }, (_, i) => `line ${i} TARGETHIT`).join('\n'),
    });
  });

  after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('finds a literal match with correct path/line/col/snippet, and the exact result shape', async () => {
    const { results, truncated, stats } = await searchFiles({ rootDir, query: 'BASICHIT' });
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual(Object.keys(results[0]).sort(), ['col', 'line', 'path', 'snippet']);
    assert.strictEqual(results[0].path, 'top.md');
    assert.strictEqual(results[0].line, 1);
    assert.strictEqual(results[0].col, 7); // 'alpha ' is 6 chars, match starts at index 6
    assert.strictEqual(results[0].snippet, 'alpha BASICHIT beta');
    assert.strictEqual(truncated, false);
    assert.ok(stats.filesScanned > 0);
    assert.strictEqual(typeof stats.elapsedMs, 'number');
  });

  it('excludes ignored directories (node_modules), matching tree visibility', async () => {
    const { results } = await searchFiles({ rootDir, query: 'NODEMODULESHIT' });
    assert.strictEqual(results.length, 0);
  });

  it('excludes dotfile-prefixed directories', async () => {
    const { results } = await searchFiles({ rootDir, query: 'HIDDENHIT' });
    assert.strictEqual(results.length, 0);
  });

  it('finds matches in nested directories with a forward-slash relative path', async () => {
    const { results } = await searchFiles({ rootDir, query: 'NESTEDHIT' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].path, 'docs/sub/nested.md');
  });

  it('skips files larger than SEARCH_MAX_FILE_BYTES entirely', async () => {
    const { results } = await searchFiles({ rootDir, query: 'HUGEHIT' });
    assert.strictEqual(results.length, 0);
  });

  it('skips binary (non markdown/code/text) files by type, without content-sniffing', async () => {
    const { results } = await searchFiles({ rootDir, query: 'PNGHIT' });
    assert.strictEqual(results.length, 0);
  });

  it('supports multibyte (Japanese) content with correct line/col', async () => {
    const { results } = await searchFiles({ rootDir, query: '見積' });
    const hits = results.filter((r) => r.path === 'jp/quote.md');
    assert.strictEqual(hits.length, 2);
    assert.strictEqual(hits[0].line, 2);
    assert.strictEqual(hits[0].col, 4); // 'これは' is 3 chars before the match
    assert.strictEqual(hits[1].line, 3);
    assert.strictEqual(hits[1].col, 1);
  });

  it('smart-case: an all-lowercase query matches case-insensitively', async () => {
    const { results } = await searchFiles({ rootDir, query: 'hello' });
    const hits = results.filter((r) => r.path === 'case.txt');
    assert.strictEqual(hits.length, 3);
  });

  it('smart-case: a query containing uppercase matches case-sensitively', async () => {
    const { results } = await searchFiles({ rootDir, query: 'Hello' });
    const hits = results.filter((r) => r.path === 'case.txt');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].line, 1);
  });

  it('clips a long line to ~160 chars centered on the match, with ellipsis markers', async () => {
    const { results } = await searchFiles({ rootDir, query: 'CLIPHIT' });
    const hit = results.find((r) => r.path === 'long-line.md');
    assert.ok(hit, 'expected a hit in long-line.md');
    assert.ok(hit.snippet.includes('CLIPHIT'));
    assert.ok(hit.snippet.startsWith('…'), 'expected leading ellipsis marker');
    assert.ok(hit.snippet.endsWith('…'), 'expected trailing ellipsis marker');
    assert.ok(hit.snippet.length <= 162, `snippet should be ~160 chars + markers, got ${hit.snippet.length}`);
  });

  it('does not clip a short line (returns the trimmed line verbatim)', async () => {
    const { results } = await searchFiles({ rootDir, query: 'SNIPHIT' });
    const hit = results.find((r) => r.path === 'short-line.md');
    assert.ok(hit, 'expected a hit in short-line.md');
    assert.strictEqual(hit.snippet, 'a short SNIPHIT line');
    assert.ok(!hit.snippet.includes('…'));
  });

  it('truncates at the requested limit', async () => {
    const { results, truncated } = await searchFiles({ rootDir, query: 'TARGETHIT', limit: 3 });
    assert.strictEqual(results.length, 3);
    assert.strictEqual(truncated, true);
    assert.deepStrictEqual(results.map((r) => r.line), [1, 2, 3]);
  });

  it('returns empty results for an empty query without scanning', async () => {
    const { results, truncated, stats } = await searchFiles({ rootDir, query: '' });
    assert.deepStrictEqual(results, []);
    assert.strictEqual(truncated, false);
    assert.strictEqual(stats.filesScanned, 0);
  });
});

describe('services/search.js — hard SEARCH_MAX_RESULTS cap', () => {
  let rootDir;

  before(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-search-cap-'));
    const lines = Array.from({ length: SEARCH_MAX_RESULTS + 100 }, (_, i) => `row ${i} CAPHIT`);
    await seed(rootDir, { 'lots.md': lines.join('\n') });
  });

  after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('never returns more than SEARCH_MAX_RESULTS even when a much larger limit is requested', async () => {
    const { results, truncated } = await searchFiles({ rootDir, query: 'CAPHIT', limit: 100000 });
    assert.strictEqual(results.length, SEARCH_MAX_RESULTS);
    assert.strictEqual(truncated, true);
  });

  it('defaults to the SEARCH_MAX_RESULTS cap when no limit is given', async () => {
    const { results, truncated } = await searchFiles({ rootDir, query: 'CAPHIT' });
    assert.strictEqual(results.length, SEARCH_MAX_RESULTS);
    assert.strictEqual(truncated, true);
  });
});

describe('api/search.js — GET /api/search (HTTP)', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'readme.md': 'API HTTPHIT content\n',
        'node_modules/skip.md': 'HTTPNODEHIT should not appear\n',
        'jp/quote.md': 'これは見積です\n',
        'multi.md': 'MULTIHIT one\nMULTIHIT two\nMULTIHIT three\n',
      },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('200s with the { results, truncated, stats } shape for a matching query', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=HTTPHIT`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.results));
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.results[0].path, 'readme.md');
    assert.strictEqual(data.results[0].line, 1);
    assert.strictEqual(typeof data.results[0].col, 'number');
    assert.strictEqual(typeof data.results[0].snippet, 'string');
    assert.strictEqual(data.truncated, false);
    assert.strictEqual(typeof data.stats.filesScanned, 'number');
    assert.strictEqual(typeof data.stats.elapsedMs, 'number');
  });

  it('excludes ignored directories end-to-end', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=HTTPNODEHIT`);
    const data = await res.json();
    assert.strictEqual(data.results.length, 0);
  });

  it('400s with SEARCH_QUERY_REQUIRED when q is missing', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search`);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.code, 'SEARCH_QUERY_REQUIRED');
  });

  it('400s with SEARCH_QUERY_REQUIRED when q is empty', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=`);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'SEARCH_QUERY_REQUIRED');
  });

  it('400s when q exceeds SEARCH_QUERY_MAX_LENGTH', async () => {
    const url = new URL(`${ctx.baseUrl}/api/search`);
    url.searchParams.set('q', 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1));
    const res = await fetch(url);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, 'SEARCH_QUERY_REQUIRED');
  });

  it('clamps a negative/zero-ish limit up to at least 1', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=MULTIHIT&limit=-5`);
    const data = await res.json();
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.truncated, true);
  });

  it('accepts a limit far above SEARCH_MAX_RESULTS without erroring (clamped internally)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=MULTIHIT&limit=99999999`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.results.length, 3);
    assert.strictEqual(data.truncated, false);
  });

  it('does not require an Origin/Host guard (read-only GET)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/search?q=HTTPHIT`, {
      headers: { Origin: 'http://evil.com' },
    });
    assert.strictEqual(res.status, 200);
  });

  it('supports a multibyte query over HTTP', async () => {
    const url = new URL(`${ctx.baseUrl}/api/search`);
    url.searchParams.set('q', '見積');
    const res = await fetch(url);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.results[0].path, 'jp/quote.md');
    assert.strictEqual(data.results[0].line, 1);
    assert.strictEqual(data.results[0].col, 4);
  });
});
