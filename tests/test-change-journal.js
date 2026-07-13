/**
 * src/services/changeJournal.js — pure in-memory snapshot store (no fs).
 *
 * Covers: basic record/get/latestHash roundtrip, content-hash dedup +
 * recency touch, per-file version cap (maxVersionsPerFile), oversized-file
 * hash-only behavior, global byte-budget LRU eviction across files, and the
 * pin (Fix 1/2, 2026-07-13 — see 実装計画_2026-07-13_reviewベースライン消失.md)
 * that protects the client's confirmed diff baseline from BOTH the version
 * cap and the global LRU regardless of how much time or how many autosave
 * cycles pass.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createChangeJournal } from '../src/services/changeJournal.js';
import { makeEtag } from '../src/utils/etag.js';

describe('changeJournal — basic record/get/latestHash', () => {
  it('records a snapshot and retrieves it by hash', () => {
    const journal = createChangeJournal();
    const hash = journal.record('a.md', '# hello');
    assert.strictEqual(hash, makeEtag('# hello'));
    assert.strictEqual(journal.get('a.md', hash), '# hello');
  });

  it('get() returns null for an unknown path', () => {
    const journal = createChangeJournal();
    assert.strictEqual(journal.get('never-seen.md', 'sha256:whatever'), null);
  });

  it('get() returns null for a known path but unknown hash', () => {
    const journal = createChangeJournal();
    journal.record('a.md', 'v1');
    assert.strictEqual(journal.get('a.md', 'sha256:doesnotexist'), null);
  });

  it('latestHash() reflects the most recently recorded version', () => {
    const journal = createChangeJournal();
    assert.strictEqual(journal.latestHash('a.md'), null, 'unknown path -> null');
    const h1 = journal.record('a.md', 'v1');
    assert.strictEqual(journal.latestHash('a.md'), h1);
    const h2 = journal.record('a.md', 'v2');
    assert.strictEqual(journal.latestHash('a.md'), h2);
    assert.notStrictEqual(h1, h2);
    // Both versions remain independently retrievable.
    assert.strictEqual(journal.get('a.md', h1), 'v1');
    assert.strictEqual(journal.get('a.md', h2), 'v2');
  });

  it('re-recording identical content is a dedup (same hash, still retrievable, no duplicate version)', () => {
    const journal = createChangeJournal();
    const h1 = journal.record('a.md', 'same content');
    const h2 = journal.record('a.md', 'same content');
    assert.strictEqual(h1, h2);
    assert.strictEqual(journal.listVersions('a.md').length, 1);
    assert.strictEqual(journal.get('a.md', h1), 'same content');
  });

  it('tracks independent histories per path', () => {
    const journal = createChangeJournal();
    const hA = journal.record('a.md', 'content A');
    const hB = journal.record('b.md', 'content B');
    assert.strictEqual(journal.get('a.md', hA), 'content A');
    assert.strictEqual(journal.get('b.md', hB), 'content B');
    assert.strictEqual(journal.get('a.md', hB), null, 'hash from a different path is not found');
  });
});

describe('changeJournal — per-file version cap (maxVersionsPerFile)', () => {
  it('drops the oldest version once more than maxVersionsPerFile distinct versions are recorded', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 3 });
    const hashes = [];
    for (let i = 0; i < 5; i++) {
      hashes.push(journal.record('a.md', `v${i}`));
    }
    const versions = journal.listVersions('a.md');
    assert.strictEqual(versions.length, 3, 'capped at maxVersionsPerFile');
    // The 3 most recent (v2, v3, v4) should remain; v0/v1 are gone.
    assert.deepStrictEqual(versions.map((v) => v.hash), [hashes[2], hashes[3], hashes[4]]);
    assert.strictEqual(journal.get('a.md', hashes[0]), null, 'oldest version evicted');
    assert.strictEqual(journal.get('a.md', hashes[1]), null, 'second-oldest version evicted');
    assert.strictEqual(journal.get('a.md', hashes[4]), 'v4', 'newest version still present');
    assert.strictEqual(journal.latestHash('a.md'), hashes[4]);
  });

  it('the per-file cap does not affect other paths', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 2 });
    journal.record('a.md', 'a1');
    journal.record('a.md', 'a2');
    journal.record('a.md', 'a3'); // evicts a1
    const hB = journal.record('b.md', 'b1');
    assert.strictEqual(journal.listVersions('a.md').length, 2);
    assert.strictEqual(journal.listVersions('b.md').length, 1);
    assert.strictEqual(journal.get('b.md', hB), 'b1');
  });
});

describe('changeJournal — oversized file (hash-only, no content stored)', () => {
  it('a file over maxBytesPerFile keeps its hash but content is null', () => {
    const journal = createChangeJournal({ maxBytesPerFile: 10 });
    const bigContent = 'x'.repeat(11);
    const hash = journal.record('big.md', bigContent);
    assert.strictEqual(hash, makeEtag(bigContent), 'hash is still the real content hash');
    assert.strictEqual(journal.get('big.md', hash), null, 'content not stored');
    assert.strictEqual(journal.latestHash('big.md'), hash, 'the version is still remembered');

    const versions = journal.listVersions('big.md');
    assert.strictEqual(versions.length, 1);
    assert.strictEqual(versions[0].hasContent, false);
    assert.strictEqual(versions[0].bytes, 0, 'no bytes charged against the budget');
  });

  it('a file within the byte cap stores content normally', () => {
    const journal = createChangeJournal({ maxBytesPerFile: 10 });
    const hash = journal.record('small.md', 'ok');
    assert.strictEqual(journal.get('small.md', hash), 'ok');
    assert.strictEqual(journal.listVersions('small.md')[0].hasContent, true);
  });

  it('multibyte content is measured in UTF-8 bytes, not JS string length', () => {
    // 6 Japanese characters = 6 UTF-16 code units but 18 UTF-8 bytes.
    const journal = createChangeJournal({ maxBytesPerFile: 15 });
    const jp = 'これは見積です'.slice(0, 6); // 6 chars, well over 15 bytes in utf-8
    const hash = journal.record('jp.md', jp);
    assert.strictEqual(journal.get('jp.md', hash), null, 'oversized by UTF-8 byte length');
  });
});

describe('changeJournal — global byte-budget LRU eviction (maxBytesTotal)', () => {
  it('evicts the globally least-recently-touched snapshot when the total budget is exceeded', () => {
    // Each snapshot is 10 bytes; budget only fits 2 at a time.
    const journal = createChangeJournal({ maxBytesTotal: 20, maxBytesPerFile: 100, maxVersionsPerFile: 100 });

    const h1 = journal.record('one.md', '1'.repeat(10));
    const h2 = journal.record('two.md', '2'.repeat(10));
    // Both fit exactly (20 bytes total).
    assert.strictEqual(journal.get('one.md', h1), '1'.repeat(10));
    assert.strictEqual(journal.get('two.md', h2), '2'.repeat(10));

    // A third snapshot pushes the total to 30 — over budget — evicting the
    // globally oldest (one.md's h1, recorded first and never touched since).
    const h3 = journal.record('three.md', '3'.repeat(10));
    assert.strictEqual(journal.get('one.md', h1), null, 'oldest snapshot evicted (content only)');
    assert.strictEqual(journal.get('two.md', h2), '2'.repeat(10), 'second snapshot survives');
    assert.strictEqual(journal.get('three.md', h3), '3'.repeat(10), 'newest snapshot present');

    // The evicted version record itself (hash/metadata) is still remembered —
    // only its content byte payload was dropped.
    assert.strictEqual(journal.latestHash('one.md'), h1);
    assert.strictEqual(journal.listVersions('one.md')[0].hasContent, false);
  });

  it('re-recording (touching) a snapshot protects it from being the next eviction victim', () => {
    const journal = createChangeJournal({ maxBytesTotal: 20, maxBytesPerFile: 100, maxVersionsPerFile: 100 });

    const h1 = journal.record('one.md', '1'.repeat(10));
    const h2 = journal.record('two.md', '2'.repeat(10));
    // Touch one.md's snapshot again (identical content -> same hash, recency refreshed).
    journal.record('one.md', '1'.repeat(10));

    // Now two.md's h2 is the globally oldest untouched snapshot.
    const h3 = journal.record('three.md', '3'.repeat(10));
    assert.strictEqual(journal.get('two.md', h2), null, 'two.md (not touched) is evicted instead');
    assert.strictEqual(journal.get('one.md', h1), '1'.repeat(10), 'touched snapshot survives');
    assert.strictEqual(journal.get('three.md', h3), '3'.repeat(10));
  });

  it('evicts multiple snapshots if needed to fit one large new snapshot under budget', () => {
    const journal = createChangeJournal({ maxBytesTotal: 25, maxBytesPerFile: 100, maxVersionsPerFile: 100 });

    const h1 = journal.record('one.md', '1'.repeat(10));
    const h2 = journal.record('two.md', '2'.repeat(10));
    // A 20-byte snapshot needs both prior 10-byte entries evicted to fit (10+10+20=40 > 25).
    const h3 = journal.record('three.md', '3'.repeat(20));

    assert.strictEqual(journal.get('one.md', h1), null);
    assert.strictEqual(journal.get('two.md', h2), null);
    assert.strictEqual(journal.get('three.md', h3), '3'.repeat(20));
  });
});

describe('changeJournal — re-recording restores LRU-evicted content (codex round-2)', () => {
  it('an evicted baseline becomes diffable again after the same content is re-recorded', () => {
    // Tiny global budget: recording B evicts A's content (record survives).
    const journal = createChangeJournal({ maxBytesTotal: 10, maxBytesPerFile: 8, maxVersionsPerFile: 4 });
    const hashA = journal.record('a.md', 'AAAAAAA');   // 7 bytes
    journal.record('b.md', 'BBBBBBB');                 // 7 bytes -> evicts a.md content
    assert.strictEqual(journal.get('a.md', hashA), null, 'precondition: A content evicted');

    journal.record('a.md', 'AAAAAAA'); // same hash, same content -> restore
    assert.strictEqual(journal.get('a.md', hashA), 'AAAAAAA', 'content restored on re-record');
  });
});

describe('changeJournal — get() refreshes LRU recency (codex round-3)', () => {
  it('a just-read baseline survives the next eviction over a colder entry', () => {
    // Budget fits exactly two 7-byte entries.
    const journal = createChangeJournal({ maxBytesTotal: 14, maxBytesPerFile: 8, maxVersionsPerFile: 4 });
    const hashA = journal.record('a.md', 'AAAAAAA'); // oldest
    const hashB = journal.record('b.md', 'BBBBBBB');
    journal.get('a.md', hashA);                      // touch A -> B becomes coldest
    journal.record('c.md', 'CCCCCCC');               // evicts ONE entry
    assert.strictEqual(journal.get('a.md', hashA), 'AAAAAAA', 'recently-read A survives');
    assert.strictEqual(journal.get('b.md', hashB), null, 'cold B was evicted instead');
  });
});

describe('changeJournal — per-file cap runs before global eviction (codex round-6)', () => {
  it('a transient overage resolved by the version cap does not evict another file', () => {
    // Budget 21 fits three 7-byte entries. a.md holds 2 versions (cap=2).
    const journal = createChangeJournal({ maxBytesTotal: 21, maxBytesPerFile: 8, maxVersionsPerFile: 2 });
    journal.record('a.md', 'A1A1A1A');
    const hashB = journal.record('b.md', 'BBBBBBB');
    journal.record('a.md', 'A2A2A2A');       // budget now exactly 21
    journal.record('a.md', 'A3A3A3A');       // transient 28 -> version cap drops A1 -> 21
    assert.strictEqual(journal.get('b.md', hashB), 'BBBBBBB', "b.md must survive a's version churn");
  });
});

describe('changeJournal — pin protects the client baseline from eviction (Fix 1/2, 2026-07-13)', () => {
  it('a pinned version survives the version cap across far more record() calls than the cap allows', () => {
    // Reproduces the reported bug: cap=3 (analogous to the old default of
    // 4), pin h0 as the client's baseline via get(), then blow way past the
    // cap with further edits (analogous to autosave). Under the OLD
    // versions.shift()-oldest-always logic, h0 would already be gone after
    // the 3rd extra record() (cap exceeded by 1 -> shift drops h0
    // unconditionally); this must survive all 10.
    const journal = createChangeJournal({ maxVersionsPerFile: 3 });
    const h0 = journal.record('a.md', 'v0');
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'sanity: baseline confirmed once -> pinned');
    for (let i = 1; i <= 10; i++) {
      journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'pinned baseline survives 10 records past a cap of 3');
    assert.strictEqual(journal.listVersions('a.md').length, 3, 'cap still holds for everything else');
  });

  it('an untouched middle version is evicted before one with a higher lastUsed, even when neither is the current pin', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 3 });
    const h0 = journal.record('a.md', 'v0');
    const h1 = journal.record('a.md', 'v1');
    journal.get('a.md', h1); // h1 gets a lastUsed bump (and is pinned, for now)
    journal.record('a.md', 'v2'); // still <= cap(3), no eviction yet
    journal.get('a.md', h0); // pin moves to h0; h1 keeps its earlier lastUsed but loses the pin
    const h3 = journal.record('a.md', 'v3'); // len 4 > cap(3) -> eviction: candidates are h1, h2 (h0 pinned, h3 newest)
    assert.strictEqual(journal.get('a.md', h3), 'v3', 'newest untouched by this check');
    // h2 was never touched by get() (lastUsed=0); h1 was (lastUsed>0). The
    // colder (never-used) one must be the victim, even though it isn't the
    // currently pinned hash.
    const remaining = journal.listVersions('a.md').map((v) => v.hash);
    assert.ok(remaining.includes(h0), 'pinned h0 survives');
    assert.ok(remaining.includes(h1), 'previously-touched h1 survives over the untouched middle version');
  });

  it('the newest version is never evicted by the version cap, no matter how many records follow', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 2 });
    let lastHash;
    for (let i = 0; i < 20; i++) {
      lastHash = journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', lastHash), 'v19');
    assert.strictEqual(journal.latestHash('a.md'), lastHash);
  });

  it('pin protection holds even when Date.now() is frozen — accessSeq (not wall-clock) drives lastUsed (codex #2)', (t) => {
    t.mock.method(Date, 'now', () => 123456);
    const journal = createChangeJournal({ maxVersionsPerFile: 3 });
    const h0 = journal.record('a.md', 'v0');
    journal.get('a.md', h0); // pin, with Date.now() frozen — a ms-tie-based design would fail this
    for (let i = 1; i <= 5; i++) {
      journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'pin survives cap overage even with Date.now() frozen');
  });

  it('get() on a hash whose content was already evicted/oversized does not pin or touch it', () => {
    const journal = createChangeJournal({ maxBytesPerFile: 5, maxVersionsPerFile: 3 });
    const bigHash = journal.record('a.md', 'x'.repeat(10)); // oversized -> content null immediately (a "shell")
    assert.strictEqual(journal.get('a.md', bigHash), null, 'lookup on a shell returns null (nothing to diff against)');

    // Fill past the cap with small, storable versions. If get() had wrongly
    // pinned bigHash despite the null content, it would be excluded from
    // eviction and this shell (which holds zero bytes anyway) would survive
    // indefinitely instead of being the preferred victim.
    journal.record('a.md', 'v1');
    journal.record('a.md', 'v2');
    const lastHash = journal.record('a.md', 'v3'); // len 4 > cap(3) -> eviction
    const versions = journal.listVersions('a.md');
    assert.strictEqual(versions.some((v) => v.hash === bigHash), false, 'the shell was evicted, not protected as a pin');
    assert.strictEqual(journal.get('a.md', lastHash), 'v3');
  });
});

describe('changeJournal — pin() public API (Fix 5, 2026-07-13 — src/api/diff.js\'s identical-hash branch calls this directly, since it never calls get())', () => {
  it('pin() protects an explicitly pinned version from the version cap, same as get() does', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 3 });
    const h0 = journal.record('a.md', 'v0');
    assert.strictEqual(journal.pin('a.md', h0), true, 'pin succeeds on a content-bearing version');
    for (let i = 1; i <= 10; i++) {
      journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'explicitly-pinned baseline survives 10 records past a cap of 3');
  });

  it('pin() refuses (returns false, does not protect) a content=null shell', () => {
    const journal = createChangeJournal({ maxBytesPerFile: 5, maxVersionsPerFile: 3 });
    const bigHash = journal.record('a.md', 'x'.repeat(10)); // oversized -> content null immediately (a "shell")
    assert.strictEqual(journal.pin('a.md', bigHash), false, 'pin() cannot pin a shell — nothing to diff against');

    // Fill past the cap with small, storable versions. If pin() had
    // wrongly protected bigHash despite the null content, it would be
    // excluded from eviction and survive indefinitely instead of being
    // the preferred victim (same invariant as get()'s existing test).
    journal.record('a.md', 'v1');
    journal.record('a.md', 'v2');
    const lastHash = journal.record('a.md', 'v3'); // len 4 > cap(3) -> eviction
    const versions = journal.listVersions('a.md');
    assert.strictEqual(versions.some((v) => v.hash === bigHash), false, 'the refused pin did not protect the shell');
    assert.strictEqual(journal.get('a.md', lastHash), 'v3');
  });

  it('pin() returns false for an unknown path or an unknown hash on a known path', () => {
    const journal = createChangeJournal();
    assert.strictEqual(journal.pin('never-seen.md', 'sha256:whatever'), false, 'unknown path');
    journal.record('a.md', 'v1');
    assert.strictEqual(journal.pin('a.md', 'sha256:doesnotexist'), false, 'known path, unknown hash');
  });

  it('pin() and get() share ONE pin WINDOW per path — a later pin() protects the new hash WITHOUT evicting an earlier get()-pinned hash still inside the window (codex round-2 P1, 2026-07-14: single-slot pinning let a late in-flight request for an older hash silently steal a newer pin\'s protection)', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 2 }); // default pinHistorySize (>=2) comfortably holds both
    const h0 = journal.record('a.md', 'v0');
    journal.get('a.md', h0);          // pin h0 via get()
    const h1 = journal.record('a.md', 'v1'); // len 2 == cap, no eviction yet
    journal.pin('a.md', h1);          // pin via pin() -- ADDS h1 to the window; h0 is still in it too
    // Cap is 2: from here on the newest AND every window-pinned hash
    // survive. Both h0 and h1 are still in the window, so BOTH must
    // survive despite neither being the ever-advancing "newest".
    for (let i = 2; i <= 10; i++) {
      journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', h1), 'v1', 'the more recently pinned hash (h1) survives');
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'the earlier pin (h0) is STILL protected -- it has not aged out of the window');
  });

  it('the pin window holds only the `pinHistorySize` most-recently-pinned hashes — a pin older than the window eventually loses protection', () => {
    // cap=3 so the FIRST post-aging-out record() leaves exactly ONE
    // eligible eviction candidate (h0) -- deterministic regardless of the
    // `lastUsed` tie-break rule (which a large churn loop of untouched
    // filler versions would otherwise satisfy first, since a never-pinned
    // version's lastUsed=0 is even lower than a once-pinned-then-aged-out
    // one's, masking this specific invariant).
    const journal = createChangeJournal({ maxVersionsPerFile: 3, pinHistorySize: 2 });
    const h0 = journal.record('a.md', 'v0');
    journal.pin('a.md', h0);                 // window: [h0]
    const h1 = journal.record('a.md', 'v1');
    journal.pin('a.md', h1);                 // window: [h0, h1]
    const h2 = journal.record('a.md', 'v2'); // length 3 == cap(3), no eviction yet
    journal.pin('a.md', h2);                 // window (size 2) is now [h1, h2] -- h0 ages out

    // length 4 > cap(3) -> eviction: newest(h3) and window{h1,h2} excluded,
    // leaving h0 as the ONLY eligible candidate.
    const h3 = journal.record('a.md', 'v3');

    assert.strictEqual(journal.get('a.md', h1), 'v1', 'still-in-window pin (h1) survives');
    assert.strictEqual(journal.get('a.md', h2), 'v2', 'still-in-window pin (h2) survives');
    assert.strictEqual(journal.get('a.md', h3), 'v3', 'newest survives');
    assert.strictEqual(journal.get('a.md', h0), null, 'pin older than the window (h0) is no longer protected');
  });

  it('re-pinning an already-pinned hash moves it to the most-recent end instead of duplicating it in the window', () => {
    // Same determinism trick as above: cap=2 so aging h1 out of the
    // window (via the h0 re-pin, then pinning h2) leaves it the ONLY
    // eligible eviction candidate on the next record(), with no
    // `lastUsed` ambiguity against filler versions.
    const journal = createChangeJournal({ maxVersionsPerFile: 2, pinHistorySize: 2 });
    const h0 = journal.record('a.md', 'v0');
    journal.pin('a.md', h0);                 // window: [h0]
    const h1 = journal.record('a.md', 'v1');
    journal.pin('a.md', h1);                 // window: [h0, h1]
    journal.pin('a.md', h0);                 // re-pin h0 -- window becomes [h1, h0], NOT [h0, h1, h0]
    const h2 = journal.record('a.md', 'v2'); // length 3 > cap(2), but h0/h1 both still IN the window here -> nothing evictable, overage tolerated
    journal.pin('a.md', h2);                 // window (size 2) is now [h0, h2] -- h1 (the "older" member after the re-pin) ages out

    // length 4 > cap(2) -> eviction: newest(h3) and window{h0,h2} excluded,
    // leaving h1 as the ONLY eligible candidate.
    const h3 = journal.record('a.md', 'v3');

    assert.strictEqual(journal.get('a.md', h0), 'v0', 're-pinned h0 was refreshed to the window\'s most-recent end and survives');
    assert.strictEqual(journal.get('a.md', h2), 'v2', 'h2 survives');
    assert.strictEqual(journal.get('a.md', h3), 'v3', 'newest survives');
    assert.strictEqual(journal.get('a.md', h1), null, 'h1 (not re-pinned, aged out of the size-2 window) is no longer protected');
  });
});

describe('changeJournal — a late, in-flight get() for an OLDER hash no longer evicts a NEWER confirmed pin (codex round-2 P1, 2026-07-14)', () => {
  it('H0 pin -> H1 pin (confirm) -> a delayed get() for H0 arrives -> a cap-exceeding record() still leaves H1 retrievable', () => {
    // Reproduces the exact race from the round-2 review: the user opens
    // Review (pinning H0), then confirms an edit (pinning H1) -- but a
    // STALE /api/diff request for the OLD baseline (from=H0), issued
    // before the confirm but delivered to the server after it, still
    // calls journal.get(path, H0) internally. Under the pre-fix
    // single-pin-slot design that get() unconditionally re-pinned H0,
    // silently stealing H1's protection.
    const journal = createChangeJournal({ maxVersionsPerFile: 3 }); // default pinHistorySize
    const h0 = journal.record('a.md', 'v0');
    journal.pin('a.md', h0); // user opens Review on H0
    const h1 = journal.record('a.md', 'v1');
    journal.pin('a.md', h1); // user confirms H1 ("✓確認")

    // The delayed, stale request for the OLD baseline finally lands.
    assert.strictEqual(journal.get('a.md', h0), 'v0', 'the stale request still resolves H0 (it still has content)');

    // Autosave churn blows well past the version cap with ZERO further
    // /api/diff calls in between -- same technique as the existing pin
    // tests above.
    for (let i = 2; i <= 10; i++) {
      journal.record('a.md', `v${i}`);
    }

    assert.strictEqual(
      journal.get('a.md', h1),
      'v1',
      'H1 (the client\'s actually-confirmed, most-recent baseline) must still be retrievable -- the late H0 re-pin must not have evicted it'
    );
  });
});

describe('changeJournal — forcibly evicting a pinned cell also clears its pin, so a later per-file-cap eviction can pick the now-worthless shell instead of a live version (codex round-2 P2, 2026-07-14)', () => {
  it('a pin lost to a global byte-budget forced eviction no longer blocks per-file version-cap eviction from choosing that shell', () => {
    const journal = createChangeJournal({
      maxBytesTotal: 12, // fits one 10-byte cell plus a little, but not two
      maxBytesPerFile: 100,
      maxVersionsPerFile: 2,
    });

    const hA = journal.record('a.md', 'A'.repeat(10)); // 10 bytes
    journal.pin('a.md', hA); // a.md's only cell -- and the ONLY cell in lru right now

    // b.md's own 3-byte cell would push totalBytes to 13 > 12. a.md's cell
    // is the only OTHER cell that exists, and it's pinned: evictOldestCell's
    // first pass (skip pinned) finds nothing, so its second pass ("every
    // other cell is pinned -- the budget still wins") sacrifices it anyway.
    journal.record('b.md', 'xyz');
    assert.strictEqual(journal.get('a.md', hA), null, 'precondition: the pinned cell was forcibly evicted for the byte budget');
    // Budget headroom is now 12 - 3(b.md) = 9 bytes -- plenty for the small
    // records below without triggering any FURTHER global eviction, so
    // this test stays isolated to the per-file-cap mechanism.

    const hB = journal.record('a.md', 'v2'); // a.md's 2nd distinct version (2 bytes) -- length 2 == cap(2), no eviction yet
    const hC = journal.record('a.md', 'v3'); // 3rd distinct version -> length 3 > cap(2) -> per-file eviction fires

    // Candidates (excluding newest=hC): hA (now a content-less shell) and
    // hB (a live, content-bearing version). WITHOUT the fix, pinnedByPath
    // still points at hA (stale), so the cap loop would treat hA as
    // untouchable and sacrifice the live hB instead -- an avoidable
    // unknown-baseline. WITH the fix, hA's pin was cleared the moment its
    // content was forcibly evicted, so it's an ordinary (and preferred,
    // being a worthless shell) victim.
    assert.strictEqual(journal.get('a.md', hB), 'v2', 'the live version (hB) was NOT sacrificed for the stale-pinned shell');
    const versions = journal.listVersions('a.md');
    assert.strictEqual(versions.some((v) => v.hash === hA), false, 'the now-unpinned shell (hA) was evicted instead');
    assert.strictEqual(journal.get('a.md', hC), 'v3', 'the newest version is untouched');
  });
});

describe('changeJournal — global-LRU eviction over many tracked snapshots completes quickly (codex round-2 P2 perf, 2026-07-14)', () => {
  it('records well past the byte budget across thousands of distinct paths without blowing up', () => {
    // One version per path keeps maxVersionsPerFile out of the way, so this
    // exercises ONLY the global byte-budget LRU (evictOldestCell()) -- the
    // path whose old `[...lru.keys()]` full-array-copy-per-eviction-call
    // was the round-2 P2 concern. Not a strict micro-benchmark (timing
    // varies by machine) -- just a guard against the eviction path
    // pathologically hanging/timing out with a large tracked-snapshot count.
    const journal = createChangeJournal({
      maxBytesTotal: 100 * 1000, // fits ~1000 100-byte cells at a time
      maxBytesPerFile: 1000,
      maxVersionsPerFile: 5000,
    });

    const start = Date.now();
    const total = 8000;
    const hashes = [];
    for (let i = 0; i < total; i++) {
      // 100 bytes, distinct path every call -> forces continuous eviction
      // once the ~1000-cell budget fills.
      hashes.push(journal.record(`file-${i}.md`, 'x'.repeat(100)));
    }
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 5000, `${total} records with continuous eviction should finish quickly (took ${elapsed}ms)`);

    // Sanity: the budget really was enforced (early entries' content
    // evicted, not silently allowed to grow unbounded) and the journal is
    // still internally consistent after all that churn.
    assert.strictEqual(journal.get('file-0.md', hashes[0]), null, 'an old, long-cold snapshot was evicted (content only)');
    assert.strictEqual(
      journal.get(`file-${total - 1}.md`, hashes[total - 1]),
      'x'.repeat(100),
      'the most recently written snapshot is still retrievable'
    );
  });
});

