/**
 * Single source of truth for the Origin/Host validation rule (CSRF / DNS
 * rebinding defence) originally written for the marpNote endpoints
 * (src/api/marpNote/guards.js). `src/api/marpNote/guards.js` now delegates
 * its `checkOrigin`/`checkHost` exports to this module instead of
 * duplicating the rule text.
 *
 * Accept/reject rules (unchanged from the original marpNote guards):
 *  - Host: the request's `Host` header must be one of `allowedHosts`
 *    (`localhost:<port>` / `127.0.0.1:<port>`). Missing or mismatched
 *    Host is rejected.
 *  - Origin: if an `Origin` header is present, it must be
 *    `http://<one of allowedHosts>`; anything else is rejected. If no
 *    `Origin` header is present (same-origin navigations/fetches don't
 *    always send one), the request is allowed only when
 *    `Sec-Fetch-Site: same-origin` is present; otherwise rejected.
 *  - `makeOriginGuard` applies Host first, then Origin (same order the
 *    marpNote PUT/OPTIONS handlers already use), and rejects via
 *    `sendError(res, mkError('ORIGIN_REJECTED', ...))` (403).
 */

import { mkError, sendError } from '../../utils/errors.js';

/** Build the `host:port` values accepted for this server instance. */
export function buildAllowedHosts(port) {
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

/** Origin / Sec-Fetch-Site judgement. Returns an Error or `null`. */
export function checkOrigin(req, allowedHosts) {
  const origin = req.get('Origin');
  if (origin) {
    for (const host of allowedHosts) {
      if (origin === `http://${host}`) return null;
    }
    return mkError('ORIGIN_REJECTED', 'origin not allowed');
  }
  if (req.get('Sec-Fetch-Site') === 'same-origin') return null;
  return mkError('ORIGIN_REJECTED', 'origin not allowed');
}

/** Host header judgement. Returns an Error or `null`. */
export function checkHost(req, allowedHosts) {
  const host = req.get('Host');
  if (host && allowedHosts.includes(host)) return null;
  return mkError('ORIGIN_REJECTED', 'host header not allowed');
}

/**
 * Build reusable Express middleware applying the Host + Origin guard to a
 * route. On rejection, sends the standard error envelope and does not call
 * `next()`.
 *
 * With no options, the allow-list is read from `req.app.locals.allowedHosts`
 * on EVERY request — the single list createMdvServer maintains (and refreshes
 * with the actual bound port once `start()` resolves, so `port: 0` ephemeral
 * servers guard correctly). This lazy read is the standard wiring for all
 * mutation routes; pass explicit `allowedHosts`/`port` only when there is no
 * Express app.locals to consult (e.g. unit tests).
 *
 * @param {Object} opts
 * @param {number} [opts.port] - Fixed server port (used if `allowedHosts` is omitted)
 * @param {string[]} [opts.allowedHosts] - Precomputed allowed `host:port` values
 * @returns {import('express').RequestHandler}
 */
export function makeOriginGuard({ port, allowedHosts } = {}) {
  const staticHosts = allowedHosts || (port != null ? buildAllowedHosts(port) : null);
  return function originGuard(req, res, next) {
    const hosts = staticHosts || req.app.locals.allowedHosts;
    if (!hosts || hosts.length === 0) {
      // Fail closed: a guard with no allow-list must reject, not pass.
      return sendError(res, mkError('ORIGIN_REJECTED', 'no allowed hosts configured'));
    }
    const hostErr = checkHost(req, hosts);
    if (hostErr) return sendError(res, hostErr);
    const originErr = checkOrigin(req, hosts);
    if (originErr) return sendError(res, originErr);
    return next();
  };
}

export default makeOriginGuard;
