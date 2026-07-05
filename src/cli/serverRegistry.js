/**
 * Discovery + lifecycle management of running `mdv` server processes.
 *
 * Unix-only: shells out to `lsof`/`ps`/`kill`, which don't exist on Windows.
 * (This matches the CLI's pre-existing behavior — `mdv -l`/`mdv -k` were
 * already Unix-only before this extraction; that constraint is unchanged.)
 *
 * The child-process `exec` function (and, for killServers, the `kill`
 * function) are injectable so tests can supply fake lsof/ps/kill behavior
 * instead of touching real processes on the machine running the tests.
 */

import { execSync } from 'node:child_process';

/**
 * @typedef {{pid: string, port: string, command: string}} MdvProcessInfo
 */

/**
 * List currently running `mdv` server processes by shelling out to
 * `lsof`/`ps`.
 *
 * @param {(command: string, options: object) => string} [exec] - Injectable in place of node:child_process's execSync.
 * @returns {MdvProcessInfo[]}
 */
export function getMdvProcesses(exec = execSync) {
  try {
    const result = exec('lsof -i -P -n 2>/dev/null || true', { encoding: 'utf-8' });
    const processes = [];

    for (const line of result.split('\n')) {
      if (!line.includes('node') || !line.includes('LISTEN')) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const pid = parts[1];

      // Check if this is an MDV process
      try {
        const cmdResult = exec(`ps -p ${pid} -o command= 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
        if (!cmdResult.toLowerCase().includes('mdv')) continue;

        // Extract port
        const portInfo = parts[8] || '';
        let port = '';
        if (portInfo.includes(':')) {
          port = portInfo.split(':').pop().split('->')[0];
        }

        const displayCmd = cmdResult.length > 60 ? cmdResult.slice(0, 60) + '...' : cmdResult;
        processes.push({ pid, port, command: displayCmd });
      } catch {
        continue;
      }
    }

    return processes;
  } catch {
    return [];
  }
}

/**
 * List running MDV servers to console.
 *
 * @param {(command: string, options: object) => string} [exec]
 * @returns {number} Exit code (0 = success)
 */
export function listServers(exec = execSync) {
  const processes = getMdvProcesses(exec);

  if (processes.length === 0) {
    console.log('稼働中のMDVサーバーはありません');
    return 0;
  }

  console.log(`稼働中のMDVサーバー: ${processes.length}件`);
  console.log('-'.repeat(60));
  console.log(`${'PID'.padEnd(8)} ${'Port'.padEnd(8)} Command`);
  console.log('-'.repeat(60));

  for (const proc of processes) {
    console.log(`${proc.pid.padEnd(8)} ${proc.port.padEnd(8)} ${proc.command}`);
  }

  console.log('-'.repeat(60));
  console.log('\n停止: mdv -k -a (全停止) / mdv -k <PID> (個別停止)');
  return 0;
}

/**
 * Kill MDV server(s).
 *
 * @param {string|null} target - Specific PID to kill, or null for all.
 * @param {boolean} killAll - Whether to kill all servers.
 * @param {object} [deps]
 * @param {(command: string, options: object) => string} [deps.exec] - Injectable in place of execSync.
 * @param {(pid: number|string) => void} [deps.kill] - Injectable in place of process.kill.
 * @returns {number} Exit code (0 = success, 1 = error)
 */
export function killServers(target, killAll, { exec = execSync, kill = process.kill } = {}) {
  if (target) {
    // Kill specific PID
    if (!/^\d+$/.test(target)) {
      console.log(`無効なPID: ${target}`);
      return 1;
    }
    const pid = Number(target);
    try {
      kill(pid);
      console.log(`PID ${pid} を停止しました`);
      return 0;
    } catch {
      console.log(`PID ${pid} の停止に失敗しました`);
      return 1;
    }
  }

  if (!killAll) {
    console.log('全サーバーを停止するには -a オプションが必要です');
    console.log('   mdv -k -a     全サーバーを停止');
    console.log('   mdv -k <PID>  特定のサーバーを停止');
    return 1;
  }

  // Kill all servers
  const processes = getMdvProcesses(exec);

  if (processes.length === 0) {
    console.log('稼働中のMDVサーバーはありません');
    return 0;
  }

  console.log(`${processes.length}件のMDVサーバーを停止します...`);

  let killed = 0;
  for (const proc of processes) {
    try {
      kill(proc.pid);
      console.log(`  PID ${proc.pid} (port ${proc.port}) を停止`);
      killed++;
    } catch {
      console.log(`  PID ${proc.pid} の停止に失敗`);
    }
  }

  console.log(`\n完了: ${killed}/${processes.length} 件を停止しました`);
  return killed === processes.length ? 0 : 1;
}
