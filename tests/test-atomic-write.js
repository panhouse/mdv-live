/**
 * Tests for src/utils/atomicWrite.js.
 *
 * Covers:
 *  - normal overwrite preserves content
 *  - permission preservation (mode bits)
 *  - READONLY rejection
 *  - leaves no temp residue
 *  - sweepStaleTemps removes own old tmp/part files
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicWrite, sweepStaleTemps } from '../src/utils/atomicWrite.js';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-atomic-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('overwrites the file with new contents', async () => {
    const file = path.join(tmpDir, 'a.md');
    await fs.writeFile(file, 'old', 'utf-8');
    const stat = await fs.stat(file);
    await atomicWrite(file, 'new content', stat);
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'new content');
  });

  it('preserves the file mode after rename', async () => {
    const file = path.join(tmpDir, 'b.md');
    await fs.writeFile(file, 'orig', 'utf-8');
    await fs.chmod(file, 0o640);
    const stat = await fs.stat(file);
    await atomicWrite(file, 'updated', stat);
    const after = await fs.stat(file);
    assert.strictEqual(after.mode & 0o777, 0o640);
  });

  it('rejects READONLY files (no write bits)', async () => {
    const file = path.join(tmpDir, 'c.md');
    await fs.writeFile(file, 'orig', 'utf-8');
    await fs.chmod(file, 0o444);
    const stat = await fs.stat(file);
    await assert.rejects(
      () => atomicWrite(file, 'should fail', stat),
      (err) => err.code === 'READONLY'
    );
    // Restore so cleanup works
    await fs.chmod(file, 0o644);
  });

  it('leaves no temp residue on success', async () => {
    const file = path.join(tmpDir, 'd.md');
    await fs.writeFile(file, 'orig', 'utf-8');
    const stat = await fs.stat(file);
    await atomicWrite(file, 'updated', stat);
    const entries = await fs.readdir(tmpDir);
    const stragglers = entries.filter((e) => e.startsWith('.~mdv'));
    assert.deepStrictEqual(stragglers, []);
  });

  it('writes a file that does not yet exist when originalStat is null', async () => {
    const file = path.join(tmpDir, 'new.md');
    await atomicWrite(file, 'fresh', null);
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'fresh');
  });
});

describe('sweepStaleTemps', () => {
  it('removes our own old tmp file', async () => {
    const stale = path.join(tmpDir, '.~mdvtmp.99999.deadbeef.x.md');
    await fs.writeFile(stale, 'leftover', 'utf-8');
    // Make it 2 hours old
    const past = Date.now() - 2 * 60 * 60 * 1000;
    await fs.utimes(stale, past / 1000, past / 1000);
    await sweepStaleTemps(tmpDir);
    assert.rejects(() => fs.stat(stale), { code: 'ENOENT' });
  });

  it('keeps a recent tmp file (younger than 1h)', async () => {
    const fresh = path.join(tmpDir, '.~mdvtmp.99998.cafef00d.y.md');
    await fs.writeFile(fresh, 'leftover', 'utf-8');
    await sweepStaleTemps(tmpDir);
    const stat = await fs.stat(fresh);
    assert.ok(stat);
    await fs.unlink(fresh);
  });
});
