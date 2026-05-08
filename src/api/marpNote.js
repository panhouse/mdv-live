/**
 * /api/marp/decks/:encodedPath endpoint family.
 *
 *  GET    .../decks/:encodedPath              → { ok, etag, slideCount, notes,
 *                                                  notesMultiplicity, lineEnding,
 *                                                  hasBom, degraded? }
 *  PUT    .../decks/:encodedPath/slides/:N/note  (If-Match required)
 *  OPTIONS  .../decks/:encodedPath/...          CORS preflight (same-origin only)
 *
 * Concurrency: stateless. ETag (sha256 of raw source) provides optimistic
 * locking. Server does not hold a per-path mutex.
 */

import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import { validatePathReal, validatePath } from '../utils/path.js';
import { parseDeck, isMarp, renderDeck } from '../rendering/marpitAdapter.js';
import { rewriteSlideNote, validateNoteText } from '../rendering/marpNoteWriter.js';
import { analyseSource } from '../utils/lineMath.js';
import { atomicWrite } from '../utils/atomicWrite.js';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_NOTE_BYTES = 64 * 1024;
const MAX_SLIDE_INDEX = 1000;

/**
 * Per-path async mutex to atomically serialize read-check-write for
 * the same file. Without this, two concurrent PUTs with the same
 * If-Match can both read the old source, both pass ETag validation,
 * and then race their `atomicWrite` calls — last-write-wins, lost edit.
 */
const pathLocks = new Map(); // realPath → Promise (the in-flight request)

async function withPathLock(realPath, fn) {
  while (pathLocks.has(realPath)) {
    try { await pathLocks.get(realPath); } catch { /* ignore */ }
  }
  let resolve;
  const wait = new Promise((r) => { resolve = r; });
  pathLocks.set(realPath, wait);
  try {
    return await fn();
  } finally {
    pathLocks.delete(realPath);
    resolve();
  }
}

function makeEtag(rawSource) {
  return 'sha256:' + crypto.createHash('sha256').update(rawSource).digest('hex');
}

function sendError(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

function isAllowedOrigin(req, allowedHosts) {
  const origin = req.get('Origin');
  const sfs = req.get('Sec-Fetch-Site');
  // (A) Origin matches one of allowedHosts
  if (origin) {
    for (const host of allowedHosts) {
      if (origin === `http://${host}`) return true;
    }
    // origin set but doesn't match → reject
    return false;
  }
  // (B) Origin missing + Sec-Fetch-Site=same-origin (Safari < 16 / curl-friendly,
  // but require that header to be present and exactly same-origin).
  if (sfs === 'same-origin') return true;
  // origin null or absent without SFS → reject
  return false;
}

function isAllowedHost(req, allowedHosts) {
  const host = req.get('Host');
  return host && allowedHosts.includes(host);
}

function isJsonContent(req) {
  const ct = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return ct === 'application/json';
}

function buildAllowedHosts(port) {
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

function sanitiseRelativePath(decoded) {
  // Express already decoded the :encodedPath route param; do NOT decode
  // again or filenames containing literal '%' will be mangled.
  if (typeof decoded !== 'string') return null;
  if (decoded.length === 0 || decoded.length > 1024) return null;
  if (decoded.includes('\0')) return null;
  return decoded;
}

async function readDeckSafely(rootDir, relativePath) {
  if (!validatePath(relativePath, rootDir)) {
    throw Object.assign(new Error('PATH_INVALID'), { code: 'PATH_INVALID' });
  }
  const ok = await validatePathReal(relativePath, rootDir);
  if (!ok) {
    throw Object.assign(new Error('PATH_INVALID'), { code: 'PATH_INVALID' });
  }

  const fullPath = path.resolve(rootDir, relativePath);
  let realPath;
  try {
    realPath = await fs.realpath(fullPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    }
    throw err;
  }

  let fd;
  try {
    fd = await fs.open(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ELOOP') {
      throw Object.assign(new Error('PATH_INVALID: symlink at terminal'), { code: 'PATH_INVALID' });
    }
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    }
    throw err;
  }
  try {
    const stat = await fd.stat();
    const rawSource = await fd.readFile('utf-8');
    return { rawSource, stat, realPath };
  } finally {
    await fd.close();
  }
}

export function setupMarpNoteRoutes(app, options = {}) {
  const port = options.port || 8080;
  const allowedHosts = buildAllowedHosts(port);

  // Common OPTIONS handler (preflight). PNA is rejected by Origin policy.
  function handleOptions(req, res) {
    if (!isAllowedHost(req, allowedHosts)) {
      return sendError(res, 403, 'ORIGIN_REJECTED', 'host header not allowed');
    }
    if (!isAllowedOrigin(req, allowedHosts)) {
      return sendError(res, 403, 'ORIGIN_REJECTED', 'origin not allowed');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
    // Note: deliberately NOT setting Allow-Private-Network; PNA is rejected.
    return res.status(204).end();
  }

  app.options('/api/marp/decks/:encodedPath/slides/:slideIndex/note', handleOptions);
  app.options('/api/marp/decks/:encodedPath', handleOptions);

  // GET /api/marp/decks/:encodedPath
  app.get('/api/marp/decks/:encodedPath', async (req, res) => {
    if (!isAllowedHost(req, allowedHosts)) {
      return sendError(res, 403, 'ORIGIN_REJECTED', 'host header not allowed');
    }
    res.setHeader('Cache-Control', 'no-store');

    const rel = sanitiseRelativePath(req.params.encodedPath);
    if (!rel) return sendError(res, 400, 'PATH_INVALID', 'invalid path');

    let deck;
    try {
      deck = await readDeckSafely(app.locals.rootDir, rel);
    } catch (err) {
      if (err.code === 'PATH_INVALID') return sendError(res, 403, 'PATH_INVALID', err.message);
      if (err.code === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'file not found');
      console.error('marpNote GET error:', err);
      return sendError(res, 500, 'WRITE_FAILED', 'read failed');
    }

    if (!isMarp(deck.rawSource)) {
      return sendError(res, 400, 'NOT_MARP', 'not a Marp file');
    }

    const lineInfo = analyseSource(deck.rawSource);
    const etag = makeEtag(deck.rawSource);

    let parsed;
    try {
      parsed = parseDeck(deck.rawSource);
    } catch (err) {
      // Adapter contract broken: degrade to read-only. UI sees `etag: null`
      // and disables save.
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
  });

  // PUT /api/marp/decks/:encodedPath/slides/:slideIndex/note
  app.put('/api/marp/decks/:encodedPath/slides/:slideIndex/note', async (req, res) => {
    if (!isAllowedHost(req, allowedHosts)) {
      return sendError(res, 403, 'ORIGIN_REJECTED', 'host header not allowed');
    }
    if (!isAllowedOrigin(req, allowedHosts)) {
      return sendError(res, 403, 'ORIGIN_REJECTED', 'origin not allowed');
    }
    if (!isJsonContent(req)) {
      return sendError(res, 415, 'INVALID_NOTE', 'Content-Type must be application/json');
    }

    const ifMatch = req.get('If-Match');
    if (!ifMatch) {
      return sendError(res, 428, 'IF_MATCH_REQUIRED', 'If-Match header required');
    }

    const slideIndex = Number(req.params.slideIndex);
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= MAX_SLIDE_INDEX) {
      return sendError(res, 400, 'OUT_OF_RANGE', 'slideIndex out of range');
    }

    const rel = sanitiseRelativePath(req.params.encodedPath);
    if (!rel) return sendError(res, 400, 'PATH_INVALID', 'invalid path');

    // Body parsing — protect against prototype pollution by only reading
    // the `note` own-property explicitly.
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return sendError(res, 400, 'INVALID_NOTE', 'body must be JSON object');
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'note')) {
      return sendError(res, 400, 'INVALID_NOTE', 'note required');
    }
    const note = body.note;
    if (typeof note !== 'string') {
      return sendError(res, 400, 'INVALID_NOTE', 'note must be string');
    }
    const validation = validateNoteText(note);
    if (validation) return sendError(res, 400, 'INVALID_NOTE', validation);

    // Resolve the real path *before* the lock so the lock key is stable
    // across concurrent requests against the same file (even via different
    // relative-path spellings).
    let earlyDeck;
    try {
      earlyDeck = await readDeckSafely(app.locals.rootDir, rel);
    } catch (err) {
      if (err.code === 'PATH_INVALID') return sendError(res, 403, 'PATH_INVALID', err.message);
      if (err.code === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'file not found');
      console.error('marpNote PUT read error:', err);
      return sendError(res, 500, 'WRITE_FAILED', 'read failed');
    }

    return withPathLock(earlyDeck.realPath, async () => {
      // Re-read inside the lock so the etag check sees the most recent
      // contents written by any predecessor in the queue.
      let deck;
      try {
        deck = await readDeckSafely(app.locals.rootDir, rel);
      } catch (err) {
        if (err.code === 'PATH_INVALID') return sendError(res, 403, 'PATH_INVALID', err.message);
        if (err.code === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'file not found');
        console.error('marpNote PUT re-read error:', err);
        return sendError(res, 500, 'WRITE_FAILED', 'read failed');
      }

      if (!isMarp(deck.rawSource)) {
        return sendError(res, 400, 'NOT_MARP', 'not a Marp file');
      }

      const currentEtag = makeEtag(deck.rawSource);
      if (ifMatch !== currentEtag) {
        return res.status(412).json({ ok: false, code: 'STALE', currentEtag });
      }

      let parsed;
      try {
        parsed = parseDeck(deck.rawSource);
      } catch (err) {
        return sendError(res, 500, 'NOT_PARSEABLE', 'failed to parse Marp deck');
      }

      const lineInfo = analyseSource(deck.rawSource);
      let result;
      try {
        result = rewriteSlideNote(deck.rawSource, slideIndex, note, parsed, lineInfo);
      } catch (err) {
        const code = err.code || 'WRITE_FAILED';
        const status = code === 'OUT_OF_RANGE' ? 400
          : code === 'INVALID_NOTE' ? 400
          : code === 'MULTI_NOTE_READONLY' ? 409
          : 500;
        return sendError(res, status, code, err.message || code);
      }

      // Defensive re-resolve: ensure the realpath hasn't been swapped to a
      // symlink mid-request (TOCTOU best-effort).
      let realAtWrite;
      try {
        realAtWrite = await fs.realpath(path.resolve(app.locals.rootDir, rel));
      } catch (err) {
        console.error('marpNote PUT realpath at write:', err);
        return sendError(res, 500, 'WRITE_FAILED', 'realpath failed');
      }
      if (realAtWrite !== deck.realPath) {
        return sendError(res, 403, 'PATH_INVALID', 'path resolution changed during request');
      }

      try {
        await atomicWrite(realAtWrite, result.source, deck.stat);
      } catch (err) {
        const code = err.code || 'WRITE_FAILED';
        const status = code === 'READONLY' ? 403 : 500;
        return sendError(res, status, code, err.message || code);
      }

      const newEtag = makeEtag(result.source);

      // Re-parse the rewritten source so the client can refresh its local
      // notes / notesMultiplicity / etag atomically. Without this the tab
      // would have a stale `tab.raw` and `tab.notes` until the watcher
      // event arrives, opening a window where the editor or a presenter
      // re-broadcast can render or overwrite pre-save content.
      let newParsed;
      try {
        newParsed = parseDeck(result.source);
      } catch (err) {
        return sendError(res, 500, 'NOT_PARSEABLE', 'failed to re-parse after rewrite');
      }
      const rendered = renderDeck(result.source);

      return res.json({
        ok: true,
        etag: newEtag,
        normalizedNote: note,
        slideCount: newParsed.slideCount,
        notes: rendered.notes,
        notesMultiplicity: newParsed.notesMultiplicity,
        source: result.source
      });
    });
  });
}
