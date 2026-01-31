/**
 * Tests for MDV CLI
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '..', 'bin', 'mdv.js');

const VERSION_STRING = 'mdv v0.3.1';
const TITLE_STRING = 'MDV - Markdown Viewer';
const SERVER_LIST_ACTIVE = '稼働中のMDVサーバー';
const SERVER_LIST_NONE = '稼働中のMDVサーバーはありません';

/**
 * Execute CLI with given arguments and return output
 * @param {string} args - CLI arguments
 * @returns {string} stdout or stderr output
 */
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

/**
 * Assert that output contains the expected string
 * @param {string} output - CLI output
 * @param {string} expected - Expected substring
 */
function assertContains(output, expected) {
  assert.ok(output.includes(expected), `Expected output to contain "${expected}"`);
}

/**
 * Assert that output contains at least one of the expected strings
 * @param {string} output - CLI output
 * @param {string[]} expectedOptions - Array of possible expected substrings
 */
function assertContainsOneOf(output, expectedOptions) {
  const found = expectedOptions.some(option => output.includes(option));
  assert.ok(found, `Expected output to contain one of: ${expectedOptions.join(', ')}`);
}

describe('MDV CLI', () => {
  describe('Help and Version', () => {
    it('--help should show usage information', () => {
      const output = runCli('--help');
      assertContains(output, TITLE_STRING);
      assertContains(output, 'Usage:');
      assertContains(output, '--port');
      assertContains(output, '--list');
      assertContains(output, '--kill');
    });

    it('-h should show usage information', () => {
      const output = runCli('-h');
      assertContains(output, TITLE_STRING);
    });

    it('--version should show version', () => {
      const output = runCli('--version');
      assertContains(output, VERSION_STRING);
    });

    it('-v should show version', () => {
      const output = runCli('-v');
      assertContains(output, VERSION_STRING);
    });
  });

  describe('Server List', () => {
    it('-l should list servers or show no servers message', () => {
      const output = runCli('-l');
      assertContainsOneOf(output, [SERVER_LIST_ACTIVE, SERVER_LIST_NONE]);
    });

    it('--list should list servers', () => {
      const output = runCli('--list');
      assertContainsOneOf(output, [SERVER_LIST_ACTIVE, SERVER_LIST_NONE]);
    });
  });

  describe('Kill Options', () => {
    it('-k without -a should show usage hint', () => {
      const output = runCli('-k');
      assertContains(output, '全サーバーを停止するには -a オプションが必要');
    });
  });

  describe('PDF Conversion', () => {
    it('--pdf without file should show error', () => {
      const output = runCli('--pdf');
      assertContainsOneOf(output, ['Error', 'requires']);
    });

    it('--pdf with non-existent file should show error', () => {
      const output = runCli('--pdf nonexistent.md');
      assertContainsOneOf(output, ['Error', 'not found']);
    });
  });
});
