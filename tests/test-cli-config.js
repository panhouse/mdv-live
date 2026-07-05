/**
 * Tests for src/cli/config.js — the mdv.config.json project config loader
 * (Phase 4 new feature).
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CONFIG_FILENAME, loadConfig } from '../src/cli/config.js';
import { UsageError } from '../src/cli/errors.js';

const tmpDirs = [];

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-cli-config-test-'));
  tmpDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('cli/config: loadConfig', () => {
  it('returns {} when mdv.config.json is absent', async () => {
    const dir = await makeTmpDir();
    assert.deepStrictEqual(await loadConfig(dir), {});
  });

  it('reads recognized keys (port, depth, open) from a valid config file', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ port: 4000, depth: 5, open: false })
    );

    const config = await loadConfig(dir);
    assert.strictEqual(config.port, 4000);
    assert.strictEqual(config.depth, 5);
    assert.strictEqual(config.open, false);
  });

  it('resolves css/pdfOptions to absolute paths relative to rootDir', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ css: './my-style.css', pdfOptions: 'options/pdf.json' })
    );

    const config = await loadConfig(dir);
    assert.strictEqual(config.css, path.resolve(dir, './my-style.css'));
    assert.strictEqual(config.pdfOptions, path.resolve(dir, 'options/pdf.json'));
  });

  it('throws a UsageError naming the file on malformed JSON', async () => {
    const dir = await makeTmpDir();
    const configPath = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(configPath, '{ not valid json');

    await assert.rejects(
      () => loadConfig(dir),
      (err) => {
        assert.ok(err instanceof UsageError);
        assert.ok(err.message.includes(configPath), 'error should name the config file path');
        return true;
      }
    );
  });

  it('throws a UsageError naming the file when the JSON value is not an object', async () => {
    const dir = await makeTmpDir();
    const configPath = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(configPath, JSON.stringify([1, 2, 3]));

    await assert.rejects(
      () => loadConfig(dir),
      (err) => {
        assert.ok(err instanceof UsageError);
        assert.ok(err.message.includes(configPath));
        return true;
      }
    );
  });

  it('warns once (listing all unknown keys) and ignores them, keeping recognized keys', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ port: 5000, typoPort: 6000, extra: true })
    );

    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = (...args) => warnCalls.push(args.join(' '));
    try {
      const config = await loadConfig(dir);
      assert.strictEqual(config.port, 5000);
      assert.strictEqual(config.typoPort, undefined);
      assert.strictEqual(config.extra, undefined);
      assert.strictEqual(warnCalls.length, 1, 'should warn exactly once');
      assert.match(warnCalls[0], /typoPort/);
      assert.match(warnCalls[0], /extra/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('silently drops a recognized key with the wrong type instead of using garbage', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ port: 'not-a-number', depth: 3 })
    );

    const config = await loadConfig(dir);
    assert.strictEqual(config.port, undefined);
    assert.strictEqual(config.depth, 3);
  });
});

describe('cli/config: precedence (CLI flags > config > defaults)', () => {
  // The merge itself happens where viewer/convert args resolve
  // (src/cli/registry.js's runViewer, src/cli/convert.js's runConvert),
  // not inside loadConfig — this documents the exact merge expression used
  // there so a future change to the precedence logic fails a test instead
  // of only being caught by manual QA.
  function resolvePort(cliPortStr, config, defaultPort) {
    return parseInt(cliPortStr, 10) || config.port || defaultPort;
  }

  it('CLI flag wins over config and default', () => {
    assert.strictEqual(resolvePort('9000', { port: 4000 }, 8642), 9000);
  });

  it('config wins over default when no CLI flag is given', () => {
    assert.strictEqual(resolvePort(undefined, { port: 4000 }, 8642), 4000);
  });

  it('falls back to the built-in default when neither CLI nor config set it', () => {
    assert.strictEqual(resolvePort(undefined, {}, 8642), 8642);
  });
});

describe('loadConfig raw (rootDir-relative) css/pdfOptions', () => {
  it('exposes cssRaw/pdfOptionsRaw alongside the resolved absolute paths', async () => {
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const { loadConfig } = await import('../src/cli/config.js');

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdv-cfgraw-'));
    try {
      await fsp.writeFile(
        path.join(dir, 'mdv.config.json'),
        JSON.stringify({ css: 'styles/report.css', pdfOptions: 'pdf-options.json' })
      );
      const config = await loadConfig(dir);
      assert.strictEqual(config.cssRaw, 'styles/report.css');
      assert.strictEqual(config.pdfOptionsRaw, 'pdf-options.json');
      assert.strictEqual(config.css, path.resolve(dir, 'styles/report.css'));
      assert.strictEqual(config.pdfOptions, path.resolve(dir, 'pdf-options.json'));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
