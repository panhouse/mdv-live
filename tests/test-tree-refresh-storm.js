/**
 * Tree refresh-storm fixes (regression):
 *  - /api/tree/expand returns DIRECT children only (no grandchild lookahead).
 *  - POST /api/file broadcasts tree_update only when a NEW file is created,
 *    not on every save of existing content (avoids the editing tree storm).
 *
 * The client-side refresh coalescing lives in src/static/app.js (browser-only,
 * exercised by dogfood-ui, not here).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { buildFileTree, readDirPage } from '../src/api/tree.js';
import { MAX_CHILDREN_PER_DIR } from '../src/config/constants.js';
import { startTestServer } from './helpers/server.js';

describe('buildFileTree depth control (expand = direct children only)', () => {
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-tree-'));
    // tempDir/parent/{direct.md, child/grandchild.md}
    await fs.mkdir(path.join(tempDir, 'parent', 'child'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'parent', 'child', 'grandchild.md'), '# g');
    await fs.writeFile(path.join(tempDir, 'parent', 'direct.md'), '# d');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('expand (depth=1) returns direct children with subdirs unloaded — no grandchild read', async () => {
    const parent = path.join(tempDir, 'parent');
    // MAX_INITIAL_DEPTH is 1; passing it as the starting depth = direct children only.
    const children = await buildFileTree(parent, tempDir, 1);

    const childDir = children.find((c) => c.name === 'child');
    assert.ok(childDir, 'child directory is present');
    assert.strictEqual(childDir.type, 'directory');
    assert.strictEqual(childDir.loaded, false, 'subdirectory is lazy (loaded:false)');
    assert.deepStrictEqual(childDir.children, [], 'no grandchildren are preloaded');

    assert.ok(children.find((c) => c.name === 'direct.md'), 'direct file is present');
  });

  it('buildFileTree at depth 0 still supports one level of lookahead (capability)', async () => {
    const parent = path.join(tempDir, 'parent');
    const children = await buildFileTree(parent, tempDir, 0);

    const childDir = children.find((c) => c.name === 'child');
    assert.strictEqual(childDir.loaded, true, 'depth 0 loads child contents');
    assert.ok(
      childDir.children.find((g) => g.name === 'grandchild.md'),
      'grandchild is preloaded at depth 0'
    );
  });
});

// Regression (P1 fix, 2026-07 refactor): tree.js used to hide only
// node_modules/__pycache__/.git — dist/, build/, .venv/ etc. rendered in the
// tree but were NOT watched by chokidar (watcher.js already ignored 19
// patterns), so external changes to those directories never refreshed the
// UI. tree.js now shares src/utils/ignorePatterns.js (isIgnoredName) with the
// watcher, so both sides agree on what is hidden.
describe('tree hides names ignored by the watcher (isIgnoredName parity)', () => {
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-ignore-'));
    await fs.mkdir(path.join(tempDir, 'dist'));
    await fs.mkdir(path.join(tempDir, 'build'));
    await fs.mkdir(path.join(tempDir, '.venv'));
    await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=1');
    await fs.writeFile(path.join(tempDir, 'visible.md'), '# visible');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('buildFileTree omits dist/, build/, .venv/, and dotfiles', async () => {
    const items = await buildFileTree(tempDir, tempDir, 0);
    const names = items.map((i) => i.name);
    assert.ok(!names.includes('dist'), 'dist/ should be hidden (was visible pre-fix)');
    assert.ok(!names.includes('build'), 'build/ should be hidden (was visible pre-fix)');
    assert.ok(!names.includes('.venv'), '.venv/ should be hidden (was visible pre-fix)');
    assert.ok(!names.includes('.env'), 'dotfiles should be hidden');
    assert.ok(names.includes('visible.md'), 'ordinary files remain visible');
  });
});

describe('directory pagination (cap + load more)', () => {
  let tempDir;
  const CAP = MAX_CHILDREN_PER_DIR;
  const TOTAL = 505;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-page-'));
    // TOTAL flat files (zero-padded so sort order is deterministic).
    await Promise.all(
      Array.from({ length: TOTAL }, (_, i) =>
        fs.writeFile(path.join(tempDir, `f${String(i).padStart(4, '0')}.md`), 'x')
      )
    );
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('buildFileTree caps children and appends a "more" sentinel', async () => {
    const items = await buildFileTree(tempDir, tempDir, 0);
    const more = items[items.length - 1];
    assert.strictEqual(items.length, CAP + 1, 'CAP items + 1 sentinel');
    assert.strictEqual(more.type, 'more');
    assert.strictEqual(more.offset, CAP);
    assert.strictEqual(more.total, TOTAL);
    assert.strictEqual(more.remaining, TOTAL - CAP);
    assert.strictEqual(more.path, '', 'sentinel path is the (root) directory');
    assert.ok(items.slice(0, CAP).every((i) => i.type === 'file'), 'capped items are files');
  });

  it('readDirPage returns the requested slice and a sentinel until exhausted', async () => {
    const page1 = await readDirPage(tempDir, tempDir, 0, 100);
    assert.strictEqual(page1.length, 101, '100 items + sentinel');
    assert.strictEqual(page1[100].type, 'more');
    assert.strictEqual(page1[100].offset, 100);

    const lastPage = await readDirPage(tempDir, tempDir, 500, 100);
    assert.strictEqual(lastPage.length, TOTAL - 500, 'final 5 items, no sentinel');
    assert.ok(!lastPage.some((i) => i.type === 'more'), 'no sentinel on the last page');
  });
});

describe('GET /api/tree/page endpoint', () => {
  let ctx;

  before(async () => {
    const files = {};
    for (let i = 0; i < 12; i++) {
      files[`g${String(i).padStart(2, '0')}.md`] = 'x';
    }
    // A subdirectory with a child, to assert the initial tree does NOT preload.
    files['sub/inside.md'] = 'x';
    ctx = await startTestServer({ files });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('paginates the root directory', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/tree/page?path=&offset=0&limit=5`);
    assert.strictEqual(res.status, 200);
    const items = await res.json();
    assert.strictEqual(items.length, 6, '5 items + sentinel');
    assert.strictEqual(items[5].type, 'more');
    assert.strictEqual(items[5].offset, 5);
    assert.strictEqual(items[5].total, 13); // 12 files + 1 subdirectory
  });

  it('rejects path traversal', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/tree/page?path=${encodeURIComponent('../../etc')}&offset=0&limit=5`
    );
    assert.strictEqual(res.status, 403);
  });

  it('GET /api/tree returns subdirectories unloaded (no eager lookahead)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/tree`);
    assert.strictEqual(res.status, 200);
    const tree = await res.json();
    const sub = tree.find((n) => n.name === 'sub');
    assert.ok(sub, 'subdirectory present at top level');
    assert.strictEqual(sub.type, 'directory');
    assert.strictEqual(sub.loaded, false, 'subdirectory is lazy, not preloaded');
    assert.deepStrictEqual(sub.children, [], 'no children materialized up front');
  });
});

describe('POST /api/file tree_update broadcast scope', () => {
  let ctx;

  function openClient() {
    const ws = new WebSocket(ctx.baseUrl.replace(/^http/, 'ws'));
    const received = [];
    ws.on('message', (data) => {
      try {
        received.push(JSON.parse(data.toString()));
      } catch {
        /* ignore non-JSON frames */
      }
    });
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve({ ws, received }));
      ws.on('error', reject);
    });
  }

  async function savedThenSettle(body) {
    // 'Sec-Fetch-Site: same-origin' is required as of the 2026-07 refactor's
    // P1-1 fix: POST /api/file is now Origin/Host-guarded (CSRF defense,
    // src/api/file.js), so a same-origin signal is needed since this plain
    // fetch() sends no Origin header. See src/api/file.js notes.
    const res = await fetch(`${ctx.baseUrl}/api/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(body),
    });
    assert.strictEqual(res.status, 200);
    await new Promise((r) => setTimeout(r, 500)); // let watcher + debounce settle
  }

  before(async () => {
    ctx = await startTestServer({
      files: { 'existing.md': '# existing' },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('editing an existing file does NOT broadcast tree_update', async () => {
    const { ws, received } = await openClient();
    // Intentionally do not 'watch' the file.
    await savedThenSettle({ path: 'existing.md', content: '# edited content' });
    ws.close();
    assert.ok(
      !received.some((m) => m.type === 'tree_update'),
      `expected no tree_update, got: ${JSON.stringify(received)}`
    );
  });

  it('creating a new file DOES broadcast tree_update', async () => {
    const { ws, received } = await openClient();
    await savedThenSettle({ path: 'created.md', content: '# brand new' });
    ws.close();
    assert.ok(
      received.some((m) => m.type === 'tree_update'),
      `expected a tree_update for the new file, got: ${JSON.stringify(received)}`
    );
  });
});
