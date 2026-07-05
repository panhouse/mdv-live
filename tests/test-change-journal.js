/**
 * src/services/changeJournal.js — pure in-memory snapshot store (no fs).
 *
 * Covers: basic record/get/latestHash roundtrip, content-hash dedup +
 * recency touch, per-file version cap (maxVersionsPerFile), oversized-file
 * hash-only behavior, and global byte-budget LRU eviction across files.
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
