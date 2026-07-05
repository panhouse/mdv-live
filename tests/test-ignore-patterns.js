/**
 * src/utils/ignorePatterns.js — proves the tree-side (isIgnoredName) and
 * chokidar-side (CHOKIDAR_IGNORED) matchers agree on representative names.
 * Regression test for the tree.js/watcher.js drift (dist/ etc. rendered in
 * the tree but were not watched).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isIgnoredName, CHOKIDAR_IGNORED, IGNORED_NAMES } from '../src/utils/ignorePatterns.js';

function chokidarIgnores(name) {
  return CHOKIDAR_IGNORED.some((re) => re.test(name));
}

describe('ignorePatterns', () => {
  it('tree-side and chokidar-side agree: ignored names', () => {
    for (const name of ['node_modules', 'dist', '.venv', '.DS_Store']) {
      assert.strictEqual(isIgnoredName(name), true, `isIgnoredName(${name}) should be true`);
      assert.strictEqual(chokidarIgnores(name), true, `CHOKIDAR_IGNORED should match ${name}`);
    }
  });

  it('tree-side and chokidar-side agree: a normal file is visible', () => {
    assert.strictEqual(isIgnoredName('normal.md'), false);
    assert.strictEqual(chokidarIgnores('normal.md'), false);
  });

  it('hides all canonical names', () => {
    for (const name of IGNORED_NAMES) {
      assert.strictEqual(isIgnoredName(name), true, `isIgnoredName(${name}) should be true`);
    }
  });

  it('hides dotfiles generically (mirrors the watcher dotfile rule)', () => {
    assert.strictEqual(isIgnoredName('.env'), true);
    assert.strictEqual(isIgnoredName('.hidden'), true);
  });

  it('hides *.pyc files', () => {
    assert.strictEqual(isIgnoredName('module.pyc'), true);
  });
});
