/**
 * Tests for MDV CLI
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '..', 'bin', 'mdv.js');

function runCli(args = '') {
  try {
    return execSync(`node ${cliPath} ${args}`, {
      encoding: 'utf-8',
      timeout: 5000
    });
  } catch (err) {
    return err.stdout || err.stderr || '';
  }
}

describe('MDV CLI', () => {
  describe('Help and Version', () => {
    it('--help should show usage information', () => {
      const output = runCli('--help');
      assert.ok(output.includes('MDV - Markdown Viewer'));
      assert.ok(output.includes('Usage:'));
      assert.ok(output.includes('--port'));
      assert.ok(output.includes('--list'));
      assert.ok(output.includes('--kill'));
    });

    it('-h should show usage information', () => {
      const output = runCli('-h');
      assert.ok(output.includes('MDV - Markdown Viewer'));
    });

    it('--version should show version', () => {
      const output = runCli('--version');
      assert.ok(output.includes('mdv v0.3.1'));
    });

    it('-v should show version', () => {
      const output = runCli('-v');
      assert.ok(output.includes('mdv v0.3.1'));
    });
  });

  describe('Server List', () => {
    it('-l should list servers or show no servers message', () => {
      const output = runCli('-l');
      // Either shows server list or "no servers" message
      assert.ok(
        output.includes('稼働中のMDVサーバー') ||
        output.includes('稼働中のMDVサーバーはありません')
      );
    });

    it('--list should list servers', () => {
      const output = runCli('--list');
      assert.ok(
        output.includes('稼働中のMDVサーバー') ||
        output.includes('稼働中のMDVサーバーはありません')
      );
    });
  });

  describe('Kill Options', () => {
    it('-k without -a should show usage hint', () => {
      const output = runCli('-k');
      assert.ok(output.includes('全サーバーを停止するには -a オプションが必要'));
    });
  });

  describe('PDF Conversion', () => {
    it('--pdf without file should show error', () => {
      const output = runCli('--pdf');
      assert.ok(output.includes('Error') || output.includes('requires'));
    });

    it('--pdf with non-existent file should show error', () => {
      const output = runCli('--pdf nonexistent.md');
      assert.ok(output.includes('Error') || output.includes('not found'));
    });
  });
});
