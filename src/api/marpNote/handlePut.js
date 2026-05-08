/**
 * PUT /api/marp/decks/:encodedPath/slides/:slideIndex/note
 *
 * Optimistic locking via If-Match (sha256 etag) + per-path async mutex
 * for read-check-write atomicity within this process.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parseDeck, isMarp, renderDeck } from '../../rendering/marpitAdapter.js';
import { rewriteSlideNote } from '../../rendering/marpNoteWriter.js';
import { analyseSource } from '../../utils/lineMath.js';
import { atomicWrite } from '../../utils/atomicWrite.js';
import { mkError, sendError } from '../../utils/errors.js';
import { makeEtag } from '../../utils/etag.js';
import { withLock } from '../../concurrency/pathLock.js';
import {
  checkHost, checkOrigin, checkJsonContent, checkIfMatch,
  parseSlideIndex, sanitiseRelativePath, extractNote
} from './guards.js';
import { readDeckSafely } from './readDeck.js';

export function makePutHandler({ rootDir, allowedHosts }) {
  return async function handlePut(req, res) {
    const guards = [
      checkHost(req, allowedHosts),
      checkOrigin(req, allowedHosts),
      checkJsonContent(req),
      checkIfMatch(req)
    ];
    for (const err of guards) if (err) return sendError(res, err);

    const idx = parseSlideIndex(req);
    if (idx.error) return sendError(res, idx.error);
    const rel = sanitiseRelativePath(req.params.encodedPath);
    if (!rel) return sendError(res, mkError('PATH_INVALID', 'invalid path'));
    const noteIn = extractNote(req);
    if (noteIn.error) return sendError(res, noteIn.error);

    const ifMatch = req.get('If-Match');

    // Resolve realpath BEFORE acquiring the lock so requests against the
    // same file (via different relative paths) share the same lock key.
    let earlyDeck;
    try {
      earlyDeck = await readDeckSafely(rootDir(), rel);
    } catch (err) {
      if (err.code === 'PATH_INVALID' || err.code === 'NOT_FOUND') return sendError(res, err);
      console.error('marpNote PUT read error:', err);
      return sendError(res, mkError('READ_FAILED', 'read failed', { cause: err }));
    }

    // Trampoline: handle the realpath-retarget retry OUTSIDE of any
    // existing lock. If we re-acquired a new lock while still holding the
    // old one, two opposite retargets could deadlock. Instead we let the
    // first attempt return a sentinel, release the old lock by exiting
    // its withLock callback, then re-acquire on the new realpath.
    let attemptDeck = earlyDeck;
    for (let i = 0; i < 2; i++) {
      const result = await withLock(attemptDeck.realPath, () =>
        performNoteUpdate({
          req, res, rootDir, rel,
          slideIndex: idx.value,
          note: noteIn.value,
          ifMatch,
          earlyDeck: attemptDeck
        })
      );
      if (!result || !result.retargetTo) return result;
      attemptDeck = result.retargetTo;
    }
    return sendError(res, mkError('PATH_INVALID', 'realpath unstable across retries'));
  };
}

async function performNoteUpdate({ req, res, rootDir, rel, slideIndex, note, ifMatch, earlyDeck }) {
  // Re-read inside the lock so the etag check sees writes by predecessors.
  let deck;
  try {
    deck = await readDeckSafely(rootDir(), rel);
  } catch (err) {
    if (err.code === 'PATH_INVALID' || err.code === 'NOT_FOUND') return sendError(res, err);
    console.error('marpNote PUT re-read error:', err);
    return sendError(res, mkError('READ_FAILED', 'read failed', { cause: err }));
  }

  if (!isMarp(deck.rawSource)) {
    return sendError(res, mkError('NOT_MARP', 'not a Marp file'));
  }

  // If the symlink target changed between pre-lock and in-lock reads, the
  // mutex we hold doesn't cover the deck we'd write. Return a sentinel so
  // the caller can release THIS lock first and re-acquire on the new
  // realpath (preventing nested-lock deadlocks under opposite retargets).
  if (deck.realPath !== earlyDeck.realPath) {
    return { retargetTo: deck };
  }

  const currentEtag = makeEtag(deck.rawSource);
  if (ifMatch !== currentEtag) {
    return res.status(412).json({ ok: false, code: 'STALE', currentEtag });
  }

  let parsed;
  try {
    parsed = parseDeck(deck.rawSource);
  } catch (err) {
    return sendError(res, mkError('NOT_PARSEABLE', 'failed to parse Marp deck', { cause: err }));
  }

  const lineInfo = analyseSource(deck.rawSource);
  let result;
  try {
    result = rewriteSlideNote(deck.rawSource, slideIndex, note, parsed, lineInfo);
  } catch (err) {
    return sendError(res, err.code ? err : mkError('WRITE_FAILED', err.message, { cause: err }));
  }

  // Defensive realpath re-resolve (TOCTOU best-effort).
  // Compare against the realpath observed by the IN-LOCK re-read (`deck`),
  // NOT the pre-lock read (`earlyDeck`). Otherwise a swap that happens
  // between the pre-lock and in-lock reads, then reverts before this
  // check, would slip past — and we'd write contents parsed from the
  // wrong file into the original path.
  let realAtWrite;
  try {
    realAtWrite = await fs.realpath(path.resolve(rootDir(), rel));
  } catch (err) {
    console.error('marpNote PUT realpath at write:', err);
    return sendError(res, mkError('WRITE_FAILED', 'realpath failed', { cause: err }));
  }
  if (realAtWrite !== deck.realPath) {
    return sendError(res, mkError('PATH_INVALID', 'path resolution changed during request'));
  }

  try {
    await atomicWrite(realAtWrite, result.source, deck.stat);
  } catch (err) {
    return sendError(res, err.code ? err : mkError('WRITE_FAILED', err.message, { cause: err }));
  }

  // Re-parse so the client refreshes notes / notesMultiplicity / etag in
  // one round-trip (no need to wait for the watcher event).
  let newParsed;
  try {
    newParsed = parseDeck(result.source);
  } catch (err) {
    return sendError(res, mkError('NOT_PARSEABLE', 'failed to re-parse after rewrite', { cause: err }));
  }
  const rendered = renderDeck(result.source);

  return res.json({
    ok: true,
    etag: makeEtag(result.source),
    normalizedNote: note,
    slideCount: newParsed.slideCount,
    notes: rendered.notes,
    notesMultiplicity: newParsed.notesMultiplicity,
    source: result.source
  });
}
