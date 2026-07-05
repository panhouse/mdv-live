/**
 * GET /api/marp/decks/:encodedPath  — read-only deck snapshot.
 */

import { parseDeck, isMarp, renderDeck } from '../../rendering/marpitAdapter.js';
import { analyseSource } from '../../utils/lineMath.js';
import { mkError, sendError } from '../../utils/errors.js';
import { makeEtag } from '../../utils/etag.js';
import { checkHost, sanitiseRelativePath } from './guards.js';
import { readDeckSafely } from './readDeck.js';

export function makeGetHandler({ rootDir, allowedHosts }) {
  // rootDir and allowedHosts are both thunks, resolved per request (the
  // allow-list is refreshed by start() once the real port is bound).
  return async function handleGet(req, res) {
    const hostErr = checkHost(req, allowedHosts());
    if (hostErr) return sendError(res, hostErr);
    res.setHeader('Cache-Control', 'no-store');

    const rel = sanitiseRelativePath(req.params.encodedPath);
    if (!rel) return sendError(res, mkError('PATH_INVALID', 'invalid path'));

    let deck;
    try {
      deck = await readDeckSafely(rootDir(), rel);
    } catch (err) {
      if (err.code === 'PATH_INVALID' || err.code === 'NOT_FOUND') return sendError(res, err);
      console.error('marpNote GET read error:', err);
      return sendError(res, mkError('READ_FAILED', 'read failed', { cause: err }));
    }

    if (!isMarp(deck.rawSource)) {
      return sendError(res, mkError('NOT_MARP', 'not a Marp file'));
    }

    const lineInfo = analyseSource(deck.rawSource);
    const etag = makeEtag(deck.rawSource);

    let parsed;
    try {
      parsed = parseDeck(deck.rawSource);
    } catch (err) {
      // Adapter contract broken — degrade to read-only (etag null).
      return res.json({
        ok: true,
        degraded: true,
        etag: null,
        slideCount: 0,
        notes: [],
        notesMultiplicity: [],
        lineEnding: lineInfo.lineEnding,
        hasBom: lineInfo.hasBom
      });
    }

    const { notes } = renderDeck(deck.rawSource);
    return res.json({
      ok: true,
      etag,
      slideCount: parsed.slideCount,
      notes,
      notesMultiplicity: parsed.notesMultiplicity,
      lineEnding: lineInfo.lineEnding,
      hasBom: lineInfo.hasBom
    });
  };
}
