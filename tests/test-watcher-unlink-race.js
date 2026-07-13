/**
 * src/watcher.js — a chokidar 'change'/'add' handler still awaiting its
 * async file read must not resurrect a path's change-journal history if an
 * 'unlink' for the SAME path fires (and wins) while it was in flight (codex
 * P2, 2026-07-14 review round).
 *
 * The existing seq-claim mechanism (claimEventSeq()/pathEventSeq, codex
 * rounds 6-7, see tests/test-files-changed.js's "rapid rewrite-then-delete"
 * test) only ever protected the `files_changed` BADGE FEED from this exact
 * race — it never guarded the journal.record() call itself, so a stale
 * 'change'/'add' handler could still write a deleted path's pre-deletion
 * content back into src/services/changeJournal.js right after
 * journal.deletePath() had already run for it (a file recreated after
 * deletion could then inherit a pre-deletion baseline/pin it should never
 * have seen).
 *
 * Drives the watcher's returned chokidar FSWatcher (an EventEmitter)
 * directly via .emit() instead of relying on real fs/chokidar timing, for a
 * fully deterministic interleaving: emit('change'/'add', ...) runs its
 * async handler synchronously up to its first `await` (claiming a seq on
 * the way), then emit('unlink', ...) — a fully SYNCHRONOUS handler — runs
 * to completion (journal.deletePath() + its own newer seq claim) before the
 * first handler's promise can possibly resolve (promises never settle
 * synchronously, so this ordering is guaranteed regardless of machine
 * speed). Test files use a leading-dot name (matches
 * src/utils/ignorePatterns.js's CHOKIDAR_IGNORED dotfile rule) so the REAL
 * chokidar instance backing this server never ALSO independently
 * detects/fires its own events for the same writes on its own
 * awaitWriteFinish timer — that would race our deliberately-ordered
 * .emit() calls and make the assertion flaky/wrong for reasons unrelated
 * to the bug under test.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startTestServer } from './helpers/server.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('watcher.js — unlink race must not resurrect journal history (codex P2)', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({});
  });

  after(async () => {
    if (ctx) await ctx.stop();
  });

  it("a 'change' handler still awaiting renderFile() when 'unlink' wins the race must not journal.record() the stale content", async () => {
    const journal = ctx.server.app.locals.changeJournal;
    const relPath = '.race-change.md';
    const absPath = path.join(ctx.rootDir, relPath);
    await fs.writeFile(absPath, 'v1 racing edit\n', 'utf-8');

    ctx.server.watcher.emit('change', absPath);
    ctx.server.watcher.emit('unlink', absPath);

    // Let the stale 'change' handler's renderFile()/journal.record() chain
    // (real fs.readFile + markdown render, no chokidar timing involved
    // here) finish settling.
    await wait(300);

    const versions = journal.listVersions(relPath);
    assert.deepStrictEqual(
      versions,
      [],
      `a deleted path must have NO journal history, even from a 'change' handler that was still in flight when 'unlink' won the race, got: ${JSON.stringify(versions)}`
    );
  });

  it("an 'add' handler still awaiting fs.stat/fs.readFile() when 'unlink' wins the race must not journal.record() the stale content", async () => {
    const journal = ctx.server.app.locals.changeJournal;
    const relPath = '.race-add.md';
    const absPath = path.join(ctx.rootDir, relPath);
    await fs.writeFile(absPath, 'brand new, about to be deleted\n', 'utf-8');

    ctx.server.watcher.emit('add', absPath);
    ctx.server.watcher.emit('unlink', absPath);

    await wait(300);

    const versions = journal.listVersions(relPath);
    assert.deepStrictEqual(
      versions,
      [],
      `a deleted path must have NO journal history, even from an 'add' handler that was still in flight when 'unlink' won the race, got: ${JSON.stringify(versions)}`
    );
  });

  it("a 'change' handler for a NON-TRACKABLE path (isTrackable() false — e.g. .html, which never enters the badge feed) still must not journal.record() after 'unlink' wins the race (codex P2-b, 2026-07-14)", async () => {
    // Before the P2-b fix, the 'change' handler only claimed a stale-event
    // seq (claimEventSeq()) for TRACKABLE paths (markdown/code/text) —
    // isTrackable() is false for .html, so seq stayed `undefined` and the
    // guard `seq !== undefined && ...` never fired for this path, letting a
    // stale 'change' handler's journal.record() run UNGUARDED even though
    // journal.record()/deletePath() apply to every changed/unlinked path
    // regardless of trackability (see the 0.6.3 comment in watcher.js) —
    // the exact "unlink deletes, then a late change resurrects" race the
    // trackable-path test above already guards, just unguarded for this one.
    const journal = ctx.server.app.locals.changeJournal;
    const relPath = '.race-change.html';
    const absPath = path.join(ctx.rootDir, relPath);
    await fs.writeFile(absPath, '<p>v1 racing edit</p>\n', 'utf-8');

    ctx.server.watcher.emit('change', absPath);
    ctx.server.watcher.emit('unlink', absPath);

    await wait(300);

    const versions = journal.listVersions(relPath);
    assert.deepStrictEqual(
      versions,
      [],
      `a deleted NON-TRACKABLE path must have NO journal history, even from a 'change' handler that was still in flight when 'unlink' won the race, got: ${JSON.stringify(versions)}`
    );
  });
});
