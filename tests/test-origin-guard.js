/**
 * src/api/middleware/originGuard.js — pure unit tests via fake req/res
 * (no HTTP server needed). Encodes the same accept/reject semantics
 * verified end-to-end in tests/test-marp-note-api.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { makeOriginGuard, checkOrigin, checkHost, buildAllowedHosts } from '../src/api/middleware/originGuard.js';

const PORT = 8642;
const ALLOWED_HOSTS = buildAllowedHosts(PORT);

function fakeReq(headers, appLocals) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    get: (name) => lower[name.toLowerCase()],
    app: { locals: appLocals || {} }
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function run(guard, headers, appLocals) {
  const req = fakeReq(headers, appLocals);
  const res = fakeRes();
  let nextCalled = false;
  guard(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

describe('makeOriginGuard', () => {
  const guard = makeOriginGuard({ allowedHosts: ALLOWED_HOSTS });

  it('allows a same-origin request (matching Origin + Host)', () => {
    const { res, nextCalled } = run(guard, {
      Origin: `http://localhost:${PORT}`,
      Host: `localhost:${PORT}`
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  });

  it('allows an absent Origin when Sec-Fetch-Site is same-origin (guards.js semantics)', () => {
    const { res, nextCalled } = run(guard, {
      Host: `localhost:${PORT}`,
      'Sec-Fetch-Site': 'same-origin'
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  });

  it('rejects a cross-origin Origin', () => {
    const { res, nextCalled } = run(guard, {
      Origin: 'http://evil.com',
      Host: `localhost:${PORT}`
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'ORIGIN_REJECTED');
  });

  it('rejects a bad Host header even with a matching Origin', () => {
    const { res, nextCalled } = run(guard, {
      Origin: `http://localhost:${PORT}`,
      Host: 'evil.com'
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'ORIGIN_REJECTED');
  });

  it('derives allowedHosts from { port } when allowedHosts is omitted', () => {
    const portGuard = makeOriginGuard({ port: PORT });
    const { nextCalled } = run(portGuard, {
      Origin: `http://127.0.0.1:${PORT}`,
      Host: `127.0.0.1:${PORT}`
    });
    assert.strictEqual(nextCalled, true);
  });

  it('with no options, reads req.app.locals.allowedHosts per request (server contract)', () => {
    const lazyGuard = makeOriginGuard();
    const locals = { allowedHosts: ALLOWED_HOSTS };
    const ok = run(lazyGuard, {
      Origin: `http://localhost:${PORT}`,
      Host: `localhost:${PORT}`
    }, locals);
    assert.strictEqual(ok.nextCalled, true);

    // The read is lazy: replacing the list (as start() does after binding
    // an ephemeral port) takes effect on the next request, same guard.
    const rebound = { allowedHosts: buildAllowedHosts(12345) };
    const after = run(lazyGuard, {
      Origin: 'http://localhost:12345',
      Host: 'localhost:12345'
    }, rebound);
    assert.strictEqual(after.nextCalled, true);
  });

  it('fails closed when no allow-list is configured anywhere', () => {
    const lazyGuard = makeOriginGuard();
    const { res, nextCalled } = run(lazyGuard, {
      Origin: `http://localhost:${PORT}`,
      Host: `localhost:${PORT}`
    }, {});
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'ORIGIN_REJECTED');
  });
});

describe('checkOrigin / checkHost (pure guard functions)', () => {
  it('checkOrigin rejects absent Origin with no Sec-Fetch-Site', () => {
    const err = checkOrigin(fakeReq({}), ALLOWED_HOSTS);
    assert.strictEqual(err.code, 'ORIGIN_REJECTED');
  });

  it('checkHost rejects a missing Host header', () => {
    const err = checkHost(fakeReq({}), ALLOWED_HOSTS);
    assert.strictEqual(err.code, 'ORIGIN_REJECTED');
  });
});
