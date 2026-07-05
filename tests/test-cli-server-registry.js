/**
 * Tests for src/cli/serverRegistry.js — mdv server discovery (`mdv -l`) and
 * lifecycle management (`mdv -k`).
 *
 * Extracted from bin/mdv.js (Phase 4): the original getMdvProcesses/
 * listServers/killServers shelled out directly to execSync/process.kill,
 * which is Unix-only process discovery that only ran inside this repo's
 * developer machine — untestable without a fake lsof/ps/kill. Both the
 * `exec` (lsof/ps) and `kill` functions are now injectable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { getMdvProcesses, killServers, listServers } from '../src/cli/serverRegistry.js';

/** Sample `lsof -i -P -n` line for a listening mdv node process. */
function lsofLine(pid, port) {
  return `node      ${pid} okamotohirono   23u  IPv4 0x1234567890abcdef      0t0  TCP *:${port} (LISTEN)`;
}

function withCapturedConsole(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn(lines);
  } finally {
    console.log = originalLog;
  }
}

describe('cli/serverRegistry: getMdvProcesses', () => {
  it('parses lsof output and filters to mdv-command processes via ps', () => {
    const lsofOutput = [
      lsofLine(1111, 8642),
      lsofLine(2222, 3000),
      'garbage line with no LISTEN',
    ].join('\n');

    function fakeExec(command) {
      if (command.startsWith('lsof')) return lsofOutput;
      if (command.includes('ps -p 1111')) return 'node /opt/homebrew/bin/mdv --no-browser';
      if (command.includes('ps -p 2222')) return 'node some-other-unrelated-process';
      throw new Error(`unexpected exec call: ${command}`);
    }

    const processes = getMdvProcesses(fakeExec);
    assert.strictEqual(processes.length, 1);
    assert.strictEqual(processes[0].pid, '1111');
    assert.strictEqual(processes[0].port, '8642');
    assert.match(processes[0].command, /mdv/);
  });

  it('returns an empty array when exec throws', () => {
    const processes = getMdvProcesses(() => {
      throw new Error('lsof not found');
    });
    assert.deepStrictEqual(processes, []);
  });

  it('returns an empty array when no lsof line is mdv-related', () => {
    function fakeExec(command) {
      if (command.startsWith('lsof')) return lsofLine(3333, 9999);
      return 'node /usr/bin/some-other-server';
    }
    assert.deepStrictEqual(getMdvProcesses(fakeExec), []);
  });
});

describe('cli/serverRegistry: listServers', () => {
  it('prints "no servers" and returns 0 when none are running', () => {
    let printed;
    withCapturedConsole((lines) => {
      const code = listServers(() => '');
      printed = lines.join('\n');
      assert.strictEqual(code, 0);
    });
    assert.match(printed, /稼働中のMDVサーバーはありません/);
  });

  it('lists running servers and returns 0', () => {
    function fakeExec(command) {
      if (command.startsWith('lsof')) return lsofLine(4242, 8642);
      return 'node /opt/homebrew/bin/mdv';
    }
    let printed;
    withCapturedConsole((lines) => {
      const code = listServers(fakeExec);
      printed = lines.join('\n');
      assert.strictEqual(code, 0);
    });
    assert.match(printed, /4242/);
    assert.match(printed, /8642/);
  });
});

describe('cli/serverRegistry: killServers', () => {
  it('kill happy path: valid target PID, kill() succeeds -> exit 0', () => {
    let killedWith;
    const code = killServers('555', false, { kill: (pid) => { killedWith = pid; } });
    assert.strictEqual(code, 0);
    assert.strictEqual(killedWith, 555);
  });

  it('kill not-found path: valid target PID, kill() throws (no such process) -> exit 1', () => {
    const code = killServers('999', false, {
      kill: () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); },
    });
    assert.strictEqual(code, 1);
  });

  it('rejects a non-numeric target PID without calling kill()', () => {
    let called = false;
    const code = killServers('not-a-pid', false, { kill: () => { called = true; } });
    assert.strictEqual(code, 1);
    assert.strictEqual(called, false);
  });

  it('requires -a to kill all servers when no target is given', () => {
    const code = killServers(null, false, { kill: () => { throw new Error('should not be called'); } });
    assert.strictEqual(code, 1);
  });

  it('kill -a with no running servers returns 0 without calling kill()', () => {
    let called = false;
    const code = killServers(null, true, {
      exec: () => '',
      kill: () => { called = true; },
    });
    assert.strictEqual(code, 0);
    assert.strictEqual(called, false);
  });

  it('kill -a kills every discovered process and returns 0 when all succeed', () => {
    function fakeExec(command) {
      if (command.startsWith('lsof')) {
        return [lsofLine(111, 8642), lsofLine(222, 8643)].join('\n');
      }
      return 'node /opt/homebrew/bin/mdv';
    }
    const killedPids = [];
    const code = killServers(null, true, {
      exec: fakeExec,
      kill: (pid) => killedPids.push(pid),
    });
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(killedPids.sort(), ['111', '222'].sort());
  });

  it('kill -a returns 1 when at least one kill() fails', () => {
    function fakeExec(command) {
      if (command.startsWith('lsof')) {
        return [lsofLine(111, 8642), lsofLine(222, 8643)].join('\n');
      }
      return 'node /opt/homebrew/bin/mdv';
    }
    const code = killServers(null, true, {
      exec: fakeExec,
      kill: (pid) => {
        if (pid === '222') throw new Error('no such process');
      },
    });
    assert.strictEqual(code, 1);
  });
});
