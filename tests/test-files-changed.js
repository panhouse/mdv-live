/**
 * src/watcher.js — `files_changed` broadcast (0.6.5 unread/seen tree
 * badges, event-driven per docs/plan-review-surface-0.6.x.md §③; consumed
 * client-side by src/static/modules/unreadBadges.js, dispatched via
 * src/static/modules/websocket.js — see docs/ARCHITECTURE.md §2.2).
 *
 * The client never hash-scans the tree — it only reacts to this feed
 * (plus diffReview.js's markSeen()/getLastSeen() baseline). Covers:
 *  - a single external `change` -> one files_changed item,
 *    { path, etag, kind: 'changed' }, etag === makeEtag(newContent)
 *  - changes to two DIFFERENT paths within one FILES_CHANGED_DEBOUNCE_MS
 *    window coalesce into a single broadcast carrying both
 *  - repeated changes to the SAME path settle to the latest etag (no
 *    stale hash lingers as the final word for that path)
 *  - a brand-new TEXT file (`add`) -> kind: 'added', no etag
 *  - a brand-new BINARY file does NOT appear in files_changed (tree_update
 *    still fires — existing behavior, unchanged)
 *  - broadcast to ALL clients (wss.broadcast), unlike file_update's
 *    watch-scoped delivery — a client that never sent `watch` still gets it
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import WebSocket from 'ws';

import { makeEtag } from '../src/utils/etag.js';
import { FILES_CHANGED_DEBOUNCE_MS } from '../src/config/constants.js';
import { startTestServer } from './helpers/server.js';

function connectClient(ctx) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ctx.baseUrl.replace(/^http/, 'ws'));
    const messages = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        /* ignore non-JSON frames */
      }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function pollUntil(fn, timeoutMs = 4000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const result = fn();
      if (result) return resolve(result);
      if (Date.now() > deadline) return reject(new Error('timed out waiting for condition'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

describe('watcher.js — files_changed broadcast', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'a.md': 'A original\n',
        'b.md': 'B original\n',
      },
    });
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it('a single external change broadcasts one files_changed item (kind: changed) carrying the raw-content etag', async () => {
    const { ws, messages } = await connectClient(ctx);
    const newContent = 'A changed\n';
    await fs.writeFile(`${ctx.rootDir}/a.md`, newContent, 'utf-8');

    const msg = await pollUntil(() =>
      messages.find((m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'a.md'))
    );
    ws.close();

    assert.ok(Array.isArray(msg.items));
    const item = msg.items.find((it) => it.path === 'a.md');
    assert.strictEqual(item.kind, 'changed');
    assert.strictEqual(item.etag, makeEtag(newContent));
  });

  it('changes to two different paths within one debounce window coalesce into a single broadcast', async () => {
    const { ws, messages } = await connectClient(ctx);
    const from = messages.length;
    const aContent = 'A coalesce\n';
    const bContent = 'B coalesce\n';

    await Promise.all([
      fs.writeFile(`${ctx.rootDir}/a.md`, aContent, 'utf-8'),
      fs.writeFile(`${ctx.rootDir}/b.md`, bContent, 'utf-8'),
    ]);

    const msg = await pollUntil(() =>
      messages.slice(from).find((m) => {
        if (m.type !== 'files_changed') return false;
        const paths = new Set(m.items.map((it) => it.path));
        return paths.has('a.md') && paths.has('b.md');
      })
    );
    ws.close();

    assert.ok(msg.items.length >= 2, 'both paths landed in the same broadcast');
    assert.strictEqual(msg.items.find((it) => it.path === 'a.md').etag, makeEtag(aContent));
    assert.strictEqual(msg.items.find((it) => it.path === 'b.md').etag, makeEtag(bContent));
  });

  it('repeated changes to the same path settle to the latest etag', async () => {
    const { ws, messages } = await connectClient(ctx);
    const from = messages.length;
    const v2 = 'A repeat v2\n';
    const v3 = 'A repeat v3\n';

    await fs.writeFile(`${ctx.rootDir}/a.md`, v2, 'utf-8');
    await new Promise((r) => setTimeout(r, 30));
    await fs.writeFile(`${ctx.rootDir}/a.md`, v3, 'utf-8');

    // Eventually a files_changed broadcast reports v3's etag for a.md —
    // whether the two writes collapsed into one chokidar `change` event or
    // two coalesced watcher.js items, the client must never end up with a
    // stale v2 hash as the last word.
    await pollUntil(() =>
      messages.slice(from).find((m) =>
        m.type === 'files_changed' && m.items.some((it) => it.path === 'a.md' && it.etag === makeEtag(v3))
      )
    );

    // Give any further debounce windows time to settle, then confirm the
    // FINAL files_changed item observed for a.md is v3's, not v2's.
    await new Promise((r) => setTimeout(r, FILES_CHANGED_DEBOUNCE_MS + 300));
    ws.close();

    const aItems = messages.slice(from)
      .filter((m) => m.type === 'files_changed')
      .flatMap((m) => m.items)
      .filter((it) => it.path === 'a.md');
    assert.ok(aItems.length > 0);
    assert.strictEqual(aItems[aItems.length - 1].etag, makeEtag(v3), 'last-observed etag for a.md is the final write');
  });

  it('adding a new text file broadcasts kind: added with no etag', async () => {
    const { ws, messages } = await connectClient(ctx);
    const from = messages.length;

    await fs.writeFile(`${ctx.rootDir}/new-note.md`, '# New\n', 'utf-8');

    const msg = await pollUntil(() =>
      messages.slice(from).find((m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'new-note.md'))
    );
    ws.close();

    const item = msg.items.find((it) => it.path === 'new-note.md');
    assert.strictEqual(item.kind, 'added');
    assert.ok(!item.etag, 'added items carry no etag');
  });

  it('deleting a text file broadcasts kind: removed (codex round-1)', async () => {
    const { ws, messages } = await connectClient(ctx);
    await fs.writeFile(`${ctx.rootDir}/doomed.md`, 'bye\n', 'utf-8');
    await pollUntil(() =>
      messages.find((m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'doomed.md' && it.kind === 'added'))
    );
    await fs.unlink(`${ctx.rootDir}/doomed.md`);
    const msg = await pollUntil(() =>
      messages.find((m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'doomed.md' && it.kind === 'removed'))
    );
    ws.close();
    const item = msg.items.find((it) => it.path === 'doomed.md' && it.kind === 'removed');
    assert.ok(item, 'removed item present');
    assert.strictEqual(item.etag, undefined);
  });

  it('changing an html file does NOT enter the badge feed (untrackable type, codex round-1)', async () => {
    const { ws, messages } = await connectClient(ctx);
    await fs.writeFile(`${ctx.rootDir}/page.html`, '<h1>v1</h1>\n', 'utf-8');
    // 'added' for html must not appear either
    await fs.writeFile(`${ctx.rootDir}/canary.md`, 'canary\n', 'utf-8');
    await pollUntil(() =>
      messages.find((m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'canary.md'))
    );
    ws.close();
    const htmlItems = messages
      .filter((m) => m.type === 'files_changed')
      .flatMap((m) => m.items)
      .filter((it) => it.path === 'page.html');
    assert.strictEqual(htmlItems.length, 0, 'html files stay out of the badge feed');
  });

  it('adding a new binary file does not broadcast files_changed (tree_update still fires)', async () => {
    const { ws, messages } = await connectClient(ctx);
    const from = messages.length;

    await fs.writeFile(
      `${ctx.rootDir}/image.png`,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    // tree_update always fires for a new file (existing, unchanged
    // behavior) — wait for it as proof the add event was fully processed
    // before asserting files_changed absence.
    await pollUntil(() => messages.slice(from).some((m) => m.type === 'tree_update'));
    // Give the files_changed debounce window (+ margin) time to have
    // fired if it were going to.
    await new Promise((r) => setTimeout(r, FILES_CHANGED_DEBOUNCE_MS + 300));
    ws.close();

    const hasImageInFilesChanged = messages.slice(from).some(
      (m) => m.type === 'files_changed' && m.items.some((it) => it.path === 'image.png')
    );
    assert.ok(!hasImageInFilesChanged, 'binary add must not appear in files_changed');
  });

  it('files_changed broadcasts to ALL clients regardless of watch (unlike file_update)', async () => {
    const { ws: ws1, messages: m1 } = await connectClient(ctx);
    const { ws: ws2, messages: m2 } = await connectClient(ctx);
    // ws2 explicitly watches an unrelated path — files_changed must not
    // respect this scoping the way broadcastFileUpdate does.
    ws2.send(JSON.stringify({ type: 'watch', path: 'b.md' }));
    await new Promise((r) => setTimeout(r, 50));

    const from1 = m1.length;
    const from2 = m2.length;
    await fs.writeFile(`${ctx.rootDir}/a.md`, 'A broadcast-all\n', 'utf-8');

    await pollUntil(() => m1.slice(from1).some((m) => m.type === 'files_changed'));
    await pollUntil(() => m2.slice(from2).some((m) => m.type === 'files_changed'));
    ws1.close();
    ws2.close();
  });
});
