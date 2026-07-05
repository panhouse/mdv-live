/**
 * Tests for src/cli/registry.js — subcommand dispatch, UsageError paths,
 * and the port-finding helpers used by the viewer command.
 *
 * Extracted from bin/mdv.js (Phase 4): before this, none of this logic was
 * exported, so only full CLI subprocess spawns (tests/test-cli.js) could
 * exercise it, and several branches (findAvailablePort retry, unknown
 * subcommand fallthrough) had no coverage at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer as createNetServer } from 'node:net';

import {
  commands,
  defaultCommand,
  dispatch,
  findAvailablePort,
  isPortAvailable,
  parseCommandArgs,
  resolveCommand,
  UsageError,
} from '../src/cli/registry.js';

describe('cli/registry: resolveCommand (OCP subcommand routing)', () => {
  it('routes "convert" to the convert command, stripping it from argv', () => {
    const { command, argv } = resolveCommand(['convert', '-i', 'a.md']);
    assert.strictEqual(command, commands.convert);
    assert.deepStrictEqual(argv, ['-i', 'a.md']);
  });

  it('falls through to the default (viewer) command for any other first token', () => {
    for (const argv of [[], ['some-dir'], ['--help'], ['-l'], ['not-a-real-subcommand']]) {
      const resolved = resolveCommand(argv);
      assert.strictEqual(resolved.command, defaultCommand);
      assert.deepStrictEqual(resolved.argv, argv, `argv should pass through unchanged for ${JSON.stringify(argv)}`);
    }
  });

  it('treats a directory literally named "convert" as a viewer target (documented pre-existing quirk)', () => {
    // This mirrors bin/mdv.js's original behavior: argv[0] === 'convert' is
    // always treated as the subcommand, even if the user meant a path.
    const { command, argv } = resolveCommand(['convert']);
    assert.strictEqual(command, commands.convert);
    assert.deepStrictEqual(argv, []);
  });
});

describe('cli/registry: parseCommandArgs (UsageError paths)', () => {
  it('returns {values, positionals} on a successful parse', () => {
    const { values, positionals } = parseCommandArgs(defaultCommand, ['-p', '3000', 'some-dir']);
    assert.strictEqual(values.port, '3000');
    assert.deepStrictEqual(positionals, ['some-dir']);
  });

  it('throws UsageError (not a raw parseArgs error) when args are invalid for the command', () => {
    // commands.convert has allowPositionals: false — a stray positional is
    // a genuine parseArgs failure even with strict:false.
    assert.throws(
      () => parseCommandArgs(commands.convert, ['stray-positional']),
      (err) => {
        assert.ok(err instanceof UsageError);
        assert.match(err.message, /Error parsing arguments:/);
        assert.strictEqual(typeof err.showHelp, 'function');
        assert.strictEqual(err.exitCode, 1);
        return true;
      }
    );
  });

  it('unrecognized long options are silently ignored (strict:false), not thrown', () => {
    // Documents the pre-existing --dev dead-flag behavior: unknown boolean
    // flags don't error, they're just absent from any code path that reads
    // known keys.
    const { values } = parseCommandArgs(defaultCommand, ['--dev']);
    assert.strictEqual(values.port, undefined);
  });
});

describe('cli/registry: dispatch', () => {
  it('dispatches "convert --help" to the convert command and returns exit code 0', async () => {
    const exitCode = await dispatch(['convert', '--help']);
    assert.strictEqual(exitCode, 0);
  });

  it('dispatches "--help" (no subcommand) to the viewer command and returns exit code 0', async () => {
    const exitCode = await dispatch(['--help']);
    assert.strictEqual(exitCode, 0);
  });

  it('dispatches "-v" to the viewer command and returns exit code 0', async () => {
    const exitCode = await dispatch(['-v']);
    assert.strictEqual(exitCode, 0);
  });

  it('propagates UsageError out of dispatch (main() is the only catcher) for convert without -i', async () => {
    await assert.rejects(
      () => dispatch(['convert']),
      (err) => {
        assert.ok(err instanceof UsageError);
        assert.match(err.message, /-i <file\.md> is required/);
        return true;
      }
    );
  });
});

describe('cli/registry: isPortAvailable / findAvailablePort', () => {
  it('isPortAvailable reports false for a port currently bound, true once released', async () => {
    const server = createNetServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    assert.strictEqual(await isPortAvailable(port), false);

    await new Promise((resolve) => server.close(resolve));
    assert.strictEqual(await isPortAvailable(port), true);
  });

  it('findAvailablePort retries past an occupied starting port', async () => {
    const server = createNetServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port: occupiedPort } = server.address();

    try {
      const found = await findAvailablePort(occupiedPort);
      assert.ok(found > occupiedPort, `expected a port after ${occupiedPort}, got ${found}`);
      assert.strictEqual(await isPortAvailable(found), true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('findAvailablePort returns null when maxRetries is exhausted', async () => {
    const server = createNetServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port: occupiedPort } = server.address();

    try {
      const found = await findAvailablePort(occupiedPort, 1);
      assert.strictEqual(found, null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
