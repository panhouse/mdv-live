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

import { buildFileTree } from '../src/api/tree.js';
import { createMdvServer } from '../src/server.js';

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

  it('initial (depth=0) preloads one level of grandchildren', async () => {
    const parent = path.join(tempDir, 'parent');
    const children = await buildFileTree(parent, tempDir, 0);

    const childDir = children.find((c) => c.name === 'child');
    assert.strictEqual(childDir.loaded, true, 'initial lookahead loads child contents');
    assert.ok(
      childDir.children.find((g) => g.name === 'grandchild.md'),
      'grandchild is preloaded at the initial depth'
    );
  });
});

describe('POST /api/file tree_update broadcast scope', () => {
  let server;
  let tempDir;
  const PORT = 19970;

  function openClient() {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
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
    const res = await fetch(`http://localhost:${PORT}/api/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.strictEqual(res.status, 200);
    await new Promise((r) => setTimeout(r, 500)); // let watcher + debounce settle
  }

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-bcast-'));
    await fs.writeFile(path.join(tempDir, 'existing.md'), '# existing');
    server = createMdvServer({ rootDir: tempDir, port: PORT });
    await server.start();
  });

  after(async () => {
    if (server) await server.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
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
