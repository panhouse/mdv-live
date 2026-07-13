/**
 * src/services/changeJournal.js — pure in-memory snapshot store (no fs).
 *
 * Covers: basic record/get/latestHash roundtrip, content-hash dedup +
 * recency touch, per-file version cap (maxVersionsPerFile), oversized-file
 * hash-only behavior, global byte-budget LRU eviction across files, the
 * pin (Fix 1/2, 2026-07-13 — see 実装計画_2026-07-13_reviewベースライン消失.md)
 * that protects the client's confirmed diff baseline from BOTH the version
 * cap and the global LRU regardless of how much time or how many autosave
 * cycles pass, and deletePath() (Fix 4).
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

  it('pin() and get() share one pin slot per path — a later pin() moves protection away from an earlier get()-pinned hash', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 2 });
    const h0 = journal.record('a.md', 'v0');
    journal.get('a.md', h0);          // pin h0 via get()
    const h1 = journal.record('a.md', 'v1'); // len 2 == cap, no eviction yet
    journal.pin('a.md', h1);          // pin via pin() -- moves the ONE pin slot to h1
    // Cap is 2: from here on only the pin (h1) and the newest survive.
    // h0 is no longer pinned and isn't the newest, so it must eventually
    // be evicted despite its earlier get()-driven lastUsed bump.
    for (let i = 2; i <= 10; i++) {
      journal.record('a.md', `v${i}`);
    }
    assert.strictEqual(journal.get('a.md', h1), 'v1', 'the current pin (h1) survives');
    assert.strictEqual(journal.get('a.md', h0), null, 'the earlier, now-superseded pin (h0) is no longer protected');
  });
});

describe('changeJournal — deletePath() (Fix 4, 2026-07-13)', () => {
  it('removes every version and pin for one path without touching another', () => {
    const journal = createChangeJournal({ maxBytesTotal: 1000 });
    const hA1 = journal.record('a.md', 'AAAAAAA');
    journal.record('a.md', 'A2A2A2A');
    const hB = journal.record('b.md', 'BBBBBBB');
    journal.get('a.md', hA1); // pin a.md

    journal.deletePath('a.md');

    assert.strictEqual(journal.listVersions('a.md').length, 0, 'a.md has no versions left');
    assert.strictEqual(journal.latestHash('a.md'), null);
    assert.strictEqual(journal.get('a.md', hA1), null, 'a.md content is gone');
    assert.strictEqual(journal.get('b.md', hB), 'BBBBBBB', 'b.md is untouched');
  });

  it('frees its byte budget — a stale charge would force an eviction that should not happen', () => {
    const journal = createChangeJournal({ maxBytesTotal: 20, maxBytesPerFile: 100, maxVersionsPerFile: 100 });
    journal.record('a.md', '1'.repeat(10)); // 10 bytes
    journal.deletePath('a.md');             // must free those 10 bytes

    const hB = journal.record('b.md', '2'.repeat(10)); // 10 bytes
    const hC = journal.record('c.md', '3'.repeat(10)); // 10 bytes; exactly 20 total IF a.md's charge is really gone

    assert.strictEqual(journal.get('b.md', hB), '2'.repeat(10), 'no stale a.md byte charge forced b.md out');
    assert.strictEqual(journal.get('c.md', hC), '3'.repeat(10));
  });

  it('clears the pin — a path recreated afterward gets normal (unpinned) cap eviction', () => {
    const journal = createChangeJournal({ maxVersionsPerFile: 2 });
    const h1 = journal.record('a.md', 'v1');
    journal.get('a.md', h1); // pin h1
    journal.deletePath('a.md');

    const h2 = journal.record('a.md', 'w1');
    journal.record('a.md', 'w2');
    const h4 = journal.record('a.md', 'w3'); // len 3 > cap(2) -> evicts w1, no stale pin protecting it
    assert.strictEqual(journal.get('a.md', h2), null, 'oldest of the fresh history was evicted normally');
    assert.strictEqual(journal.get('a.md', h4), 'w3');
  });
});
