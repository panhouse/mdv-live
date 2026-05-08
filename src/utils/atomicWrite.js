/**
 * Atomic file write with permission preservation, EXDEV fallback, and
 * O_EXCL temp creation.
 *
 * Caller passes `originalStat` taken from an earlier `fd.stat()` (so the
 * permissions on the new content match the file's prior mode/uid/gid).
 */

import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

const TMP_PREFIX = '.~mdvtmp.';
const PART_PREFIX = '.~mdvpart.';
const SWEEP_AGE_MS = 60 * 60 * 1000; // 1 hour

function mkError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function isWritable(stat) {
  // Owner-write or group-write (group/world write would already need elevated
  // perms to even reach here). Be generous: any write bit set.
  return (stat.mode & 0o222) !== 0;
}

/**
 * Atomically write `content` to `fullPath`.
 *
 * @param {string} fullPath  absolute path to overwrite
 * @param {string} content   utf-8 string contents
 * @param {fs.Stats|null} originalStat  stat from prior fd.stat(); used to
 *   restore mode/uid/gid. Pass null for new files.
 */
export async function atomicWrite(fullPath, content, originalStat) {
  if (originalStat && !isWritable(originalStat)) {
    throw mkError('READONLY', 'file is not writable');
  }

  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath);
  const tmpPath = path.join(
    dir,
    `${TMP_PREFIX}${process.pid}.${crypto.randomBytes(6).toString('hex')}.${base}`
  );

  let tmpHandle = null;
  let tmpExists = false;
  try {
    // O_EXCL: fail loudly if the random name happens to collide.
    tmpHandle = await fs.open(
      tmpPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600
    );
    tmpExists = true;
    await tmpHandle.writeFile(content, 'utf-8');

    // Restore permissions. Allow EPERM/ENOTSUP only — other failures
    // (ENOSPC, EROFS, etc.) must surface as WRITE_FAILED.
    if (originalStat) {
      try {
        await tmpHandle.chmod(originalStat.mode & 0o7777);
      } catch (e) {
        if (e.code !== 'EPERM' && e.code !== 'ENOTSUP') throw e;
      }
      try {
        await tmpHandle.chown(originalStat.uid, originalStat.gid);
      } catch (e) {
        if (e.code !== 'EPERM') throw e;
      }
    }

    await tmpHandle.close();
    tmpHandle = null;

    // Atomic replace. Try rename first; fall back to two-step on EXDEV.
    try {
      await fs.rename(tmpPath, fullPath);
      tmpExists = false;
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      const partPath = path.join(
        dir,
        `${PART_PREFIX}${crypto.randomBytes(6).toString('hex')}.${base}`
      );
      try {
        await fs.copyFile(tmpPath, partPath);
        await fs.rename(partPath, fullPath);
      } catch (err2) {
        try { await fs.unlink(partPath); } catch {}
        throw err2;
      }
      // tmpPath is still around; cleaned up in finally.
    }
  } catch (err) {
    if (err && err.code && !['READONLY', 'EPERM'].includes(err.code)) {
      // Wrap unknown failures as WRITE_FAILED so callers get a stable code.
      const wrapped = mkError('WRITE_FAILED', err.message || String(err));
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  } finally {
    if (tmpHandle) {
      try { await tmpHandle.close(); } catch {}
    }
    if (tmpExists) {
      try { await fs.unlink(tmpPath); } catch {}
    }
  }
}

/**
 * Sweep stale temp files left by previous (crashed) writes.
 * Only removes files we own (uid match) and that are older than SWEEP_AGE_MS.
 */
export async function sweepStaleTemps(rootDir) {
  let myUid;
  try {
    myUid = process.getuid();
  } catch {
    // Windows lacks getuid; sweep is best-effort there.
    myUid = null;
  }
  await sweepDir(rootDir, myUid);
}

async function sweepDir(dir, myUid) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Cap recursion depth implicitly via existing watcher depth elsewhere;
      // sweep here is shallow at rootDir to limit scan cost.
      // Skip recursion to keep startup fast — callers can opt in if needed.
      continue;
    }
    if (
      !entry.name.startsWith(TMP_PREFIX) &&
      !entry.name.startsWith(PART_PREFIX)
    ) {
      continue;
    }
    let st;
    try {
      st = await fs.lstat(full);
    } catch {
      continue;
    }
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs < SWEEP_AGE_MS) continue;
    if (myUid !== null && st.uid !== myUid) continue;
    try { await fs.unlink(full); } catch {}
  }
}
