#!/usr/bin/env node

/**
 * MDV CLI - Markdown Viewer with Marp support
 * Compatible with the original Python mdv-live CLI
 */

import { createMdvServer } from '../src/server.js';
import { parseArgs } from 'node:util';
import { execSync, spawn } from 'child_process';
import { createServer as createNetServer } from 'net';
import path from 'path';
import fs from 'fs/promises';
import open from 'open';

const DEFAULT_PORT = 8642;

// Parse command line arguments
const options = {
  port: {
    type: 'string',
    short: 'p',
  },
  'no-browser': {
    type: 'boolean',
    default: false
  },
  list: {
    type: 'boolean',
    short: 'l',
    default: false
  },
  kill: {
    type: 'boolean',
    short: 'k',
    default: false
  },
  all: {
    type: 'boolean',
    short: 'a',
    default: false
  },
  pdf: {
    type: 'boolean',
    default: false
  },
  output: {
    type: 'string',
    short: 'o',
  },
  help: {
    type: 'boolean',
    short: 'h',
    default: false
  },
  version: {
    type: 'boolean',
    short: 'v',
    default: false
  }
};

function showHelp() {
  console.log(`
MDV - Markdown Viewer with file tree + live preview + Marp support

Usage: mdv [options] [path]

Arguments:
  path                Directory or file path to view (default: current directory)

Server Options:
  -p, --port <n>      Server port (default: ${DEFAULT_PORT})
  --no-browser        Don't open browser automatically

Server Management:
  -l, --list          List running MDV servers
  -k, --kill [PID]    Stop server (-k -a for all, -k <PID> for specific)
  -a, --all           Use with -k to stop all servers

PDF Conversion:
  --pdf               Convert markdown file to PDF
  -o, --output <file> Output PDF file path

Other:
  -h, --help          Show this help message
  -v, --version       Show version number

Examples:
  mdv                    Start viewer in current directory
  mdv /path/to/dir       Start viewer in specified directory
  mdv README.md          Open specific file
  mdv --pdf README.md    Convert markdown to PDF
  mdv -p 3000            Start on port 3000
  mdv -l                 List running servers
  mdv -k -a              Stop all servers
`);
}

/**
 * Get running MDV server processes
 */
function getMdvProcesses() {
  try {
    const result = execSync('lsof -i -P -n 2>/dev/null || true', { encoding: 'utf-8' });
    const processes = [];

    for (const line of result.split('\n')) {
      if (!line.includes('node') || !line.includes('LISTEN')) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const pid = parts[1];

      // Check if this is an MDV process
      try {
        const cmdResult = execSync(`ps -p ${pid} -o command= 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
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
 * List running MDV servers
 */
function listServers() {
  const processes = getMdvProcesses();

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
 * Kill MDV server(s)
 */
function killServers(target, killAll) {
  if (target) {
    // Kill specific PID
    try {
      execSync(`kill ${target}`, { encoding: 'utf-8' });
      console.log(`PID ${target} を停止しました`);
      return 0;
    } catch {
      console.log(`PID ${target} の停止に失敗しました`);
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
  const processes = getMdvProcesses();

  if (processes.length === 0) {
    console.log('稼働中のMDVサーバーはありません');
    return 0;
  }

  console.log(`${processes.length}件のMDVサーバーを停止します...`);

  let killed = 0;
  for (const proc of processes) {
    try {
      execSync(`kill ${proc.pid}`, { encoding: 'utf-8' });
      console.log(`  PID ${proc.pid} (port ${proc.port}) を停止`);
      killed++;
    } catch {
      console.log(`  PID ${proc.pid} の停止に失敗`);
    }
  }

  console.log(`\n完了: ${killed}/${processes.length} 件を停止しました`);
  return killed === processes.length ? 0 : 1;
}

/**
 * Check if markdown content is a Marp presentation
 */
function isMarpFile(content) {
  const MARP_PATTERN = /^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/;
  return MARP_PATTERN.test(content);
}

/**
 * Convert markdown to PDF
 * - Marp slides: use marp-cli
 * - Regular markdown: use marp-cli with document-like settings
 */
async function convertToPdf(inputPath, outputPath) {
  const resolved = path.resolve(inputPath);

  try {
    await fs.access(resolved);
  } catch {
    console.error(`Error: File not found: ${inputPath}`);
    return 1;
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!['.md', '.markdown'].includes(ext)) {
    console.error(`Error: Not a markdown file: ${inputPath}`);
    return 1;
  }

  const content = await fs.readFile(resolved, 'utf-8');
  const isMarp = isMarpFile(content);

  const defaultOutput = resolved.replace(/\.(md|markdown)$/i, '.pdf');
  const finalOutput = outputPath ? path.resolve(outputPath) : defaultOutput;

  console.log(`Converting ${inputPath} to PDF...`);

  if (isMarp) {
    // Marp slide: use marp-cli directly
    try {
      execSync(`npx @marp-team/marp-cli --no-stdin "${resolved}" --pdf -o "${finalOutput}"`, {
        encoding: 'utf-8',
        stdio: 'inherit'
      });
      console.log(`PDF saved: ${finalOutput}`);
      return 0;
    } catch (err) {
      console.error('Error: PDF conversion failed');
      return 1;
    }
  } else {
    // Regular markdown: use md-to-pdf for proper A4 document format
    console.log('Converting as document (A4 portrait)...');

    try {
      execSync(`npx md-to-pdf "${resolved}" --pdf-options '{"format":"A4","margin":{"top":"20mm","right":"20mm","bottom":"20mm","left":"20mm"}}'`, {
        encoding: 'utf-8',
        stdio: 'inherit',
        cwd: path.dirname(resolved)
      });

      // md-to-pdf outputs to same directory with .pdf extension
      const generatedPdf = resolved.replace(/\.(md|markdown)$/i, '.pdf');
      if (generatedPdf !== finalOutput) {
        await fs.rename(generatedPdf, finalOutput);
      }

      console.log(`PDF saved: ${finalOutput}`);
      return 0;
    } catch (err) {
      console.error('Error: PDF conversion failed');
      console.error('Make sure md-to-pdf is available (npx md-to-pdf)');
      return 1;
    }
  }
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort, maxRetries = 100) {
  for (let i = 0; i < maxRetries; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    if (i > 0) {
      console.log(`ポート ${port - 1} は使用中です。${port} を試します...`);
    }
  }
  return null;
}

/**
 * Start MDV server with auto port increment
 */
async function startViewer(targetPath, startPort, openBrowser) {
  let rootDir = process.cwd();
  let initialFile = null;

  if (targetPath && targetPath !== '.') {
    const resolved = path.resolve(targetPath);
    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        rootDir = resolved;
      } else if (stats.isFile()) {
        rootDir = path.dirname(resolved);
        initialFile = path.basename(resolved);
      }
    } catch {
      console.error(`Error: Path not found: ${targetPath}`);
      process.exit(1);
    }
  }

  // Find available port
  const port = await findAvailablePort(startPort);
  if (!port) {
    console.error('Error: 利用可能なポートが見つかりませんでした');
    process.exit(1);
  }

  if (port !== startPort) {
    console.log(`ポート ${startPort} は使用中のため、${port} で起動します`);
  }

  // Create and start server
  const mdv = createMdvServer({ rootDir, port });
  await mdv.start();

  const url = initialFile
    ? `http://localhost:${port}?file=${encodeURIComponent(initialFile)}`
    : `http://localhost:${port}`;

  console.log(`
  MDV - Markdown Viewer with Marp support

  Server running at: ${url}
  Root directory: ${rootDir}

  Press Ctrl+C to stop
`);

  if (openBrowser) {
    await open(url);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs({
      options,
      allowPositionals: true,
      strict: false
    });
  } catch (err) {
    console.error('Error parsing arguments:', err.message);
    showHelp();
    process.exit(1);
  }

  const { values, positionals } = args;

  // Help
  if (values.help) {
    showHelp();
    process.exit(0);
  }

  // Version
  if (values.version) {
    console.log('mdv v0.3.1');
    process.exit(0);
  }

  // List servers
  if (values.list) {
    process.exit(listServers());
  }

  // Kill servers
  if (values.kill) {
    const pid = positionals[0] || null;
    process.exit(killServers(pid, values.all));
  }

  // PDF conversion
  if (values.pdf) {
    const inputPath = positionals[0];
    if (!inputPath) {
      console.error('Error: --pdf requires a markdown file path');
      process.exit(1);
    }
    process.exit(await convertToPdf(inputPath, values.output));
  }

  // Default: start viewer
  const targetPath = positionals[0] || '.';
  const port = parseInt(values.port, 10) || DEFAULT_PORT;
  const openBrowser = !values['no-browser'];

  await startViewer(targetPath, port, openBrowser);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
