/**
 * Subcommand registry + dispatch for the `mdv` CLI.
 *
 * OCP fix (was: bin/mdv.js hand-coded `if (subcommand === 'convert')`):
 * `commands` is a lookup table of { options, allowPositionals, help, run }.
 * Adding a new subcommand means adding a table entry here — main() in
 * bin/mdv.js never needs to change.
 *
 * Every command's `run()` returns a Promise<number|undefined>:
 *   - a number is the process exit code bin/mdv.js's main() should use.
 *   - `undefined` means "keep the process alive" (the viewer command
 *     started a server that holds the event loop open until Ctrl+C).
 * No command ever calls process.exit() itself — parse/validation failures
 * throw UsageError instead, which main() converts to an actual exit.
 */

import { createServer as createNetServer } from 'node:net';
import { parseArgs } from 'node:util';

import open from 'open';

import { createMdvServer } from '../server.js';
import { DEFAULT_DEPTH, DEFAULT_PORT } from '../config/constants.js';
import { getVersion } from '../utils/version.js';
import { CONVERT_OPTIONS, runConvert, showConvertHelp } from './convert.js';
import { loadConfig } from './config.js';
import { UsageError } from './errors.js';
import { resolveTargetPath } from './resolveTarget.js';
import { killServers, listServers } from './serverRegistry.js';

export { UsageError };

const VIEWER_OPTIONS = {
  port: { type: 'string', short: 'p' },
  depth: { type: 'string', short: 'd' },
  'no-browser': { type: 'boolean', default: false },
  list: { type: 'boolean', short: 'l', default: false },
  kill: { type: 'boolean', short: 'k', default: false },
  all: { type: 'boolean', short: 'a', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

/**
 * Display viewer help message.
 */
function showHelp() {
  console.log(`
MDV - Markdown Viewer with file tree + live preview + Marp support

Usage: mdv [options] [path]
       mdv convert -i <file.md> -o <file.pdf>

Arguments:
  path                Directory or file path to view (default: current directory)

Server Options:
  -p, --port <n>      Server port (default: ${DEFAULT_PORT})
  -d, --depth <n>     Directory watch depth (default: ${DEFAULT_DEPTH}, prevents EMFILE errors)
  --no-browser        Don't open browser automatically

Server Management:
  -l, --list          List running MDV servers
  -k, --kill [PID]    Stop server (-k -a for all, -k <PID> for specific)
  -a, --all           Use with -k to stop all servers

Other:
  -h, --help          Show this help message
  -v, --version       Show version number

Config file:
  mdv.config.json in the served directory can set port/depth/open/css/pdfOptions.
  Precedence: CLI flags > mdv.config.json > built-in defaults.

Examples:
  mdv                          Start viewer in current directory
  mdv /path/to/dir             Start viewer in specified directory
  mdv README.md                Open specific file
  mdv convert -i s.md -o s.pdf Convert markdown to PDF
  mdv -p 3000                  Start on port 3000
  mdv -l                       List running servers
  mdv -k -a                    Stop all servers
`);
}

/**
 * Check if a port is available for binding.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port.
 * @param {number} startPort
 * @param {number} [maxRetries=100]
 * @returns {Promise<number|null>} Available port, or null if none found within maxRetries.
 */
export async function findAvailablePort(startPort, maxRetries = 100) {
  for (let offset = 0; offset < maxRetries; offset++) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
    if (offset > 0) {
      console.log(`ポート ${port - 1} は使用中です。${port} を試します...`);
    }
  }
  return null;
}

/**
 * Start the MDV server with auto port increment. Throws UsageError instead
 * of exiting if no port is available.
 *
 * @param {{rootDir: string, initialFile: string|null, port: number, depth: number, openBrowser: boolean}} options
 */
async function startViewer({ rootDir, initialFile, port: startPort, depth, openBrowser, pdfStyleDefaults }) {
  const port = await findAvailablePort(startPort);
  if (!port) {
    throw new UsageError('Error: 利用可能なポートが見つかりませんでした');
  }

  if (port !== startPort) {
    console.log(`ポート ${startPort} は使用中のため、${port} で起動します`);
  }

  const mdv = createMdvServer({ rootDir, port, depth, pdfStyleDefaults });
  await mdv.start();

  const url = initialFile
    ? `http://localhost:${port}?path=${encodeURIComponent(initialFile)}`
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

/**
 * Run the default (no subcommand) viewer command from parsed CLI values.
 *
 * @param {{values: Record<string, unknown>, positionals: string[]}} parsed
 * @returns {Promise<number|undefined>} Exit code, or undefined to keep the process alive (server started).
 */
async function runViewer({ values, positionals }) {
  if (values.help) {
    showHelp();
    return 0;
  }

  if (values.version) {
    console.log(`mdv v${getVersion()}`);
    return 0;
  }

  if (values.list) {
    return listServers();
  }

  if (values.kill) {
    const pid = positionals[0] || null;
    return killServers(pid, values.all);
  }

  const targetPath = positionals[0] || '.';
  const { rootDir, initialFile } = await resolveTargetPath(targetPath);
  const config = await loadConfig(rootDir);

  const port = parseInt(values.port, 10) || config.port || DEFAULT_PORT;
  const depth = parseInt(values.depth, 10) || config.depth || DEFAULT_DEPTH;
  const openBrowser = values['no-browser']
    ? false
    : typeof config.open === 'boolean'
      ? config.open
      : true;

  // mdv.config.json の css/pdfOptions は Web UI の Style パネルの初期値に
  // なる（rootDir 相対の生の値を渡す。ユーザーがパネルで明示設定した値=
  // localStorage が常に優先される）。
  const pdfStyleDefaults = {};
  if (config.cssRaw) pdfStyleDefaults.css = config.cssRaw;
  if (config.pdfOptionsRaw) pdfStyleDefaults.pdfOptions = config.pdfOptionsRaw;

  await startViewer({ rootDir, initialFile, port, depth, openBrowser, pdfStyleDefaults });
  return undefined;
}

/** Subcommand table. Adding a subcommand = adding an entry here. */
export const commands = {
  convert: {
    options: CONVERT_OPTIONS,
    allowPositionals: false,
    help: showConvertHelp,
    run: runConvert,
  },
};

/** The command used when argv[0] doesn't match any key in `commands`. */
export const defaultCommand = {
  options: VIEWER_OPTIONS,
  allowPositionals: true,
  help: showHelp,
  run: runViewer,
};

/**
 * Parse argv against a command's option spec. Throws UsageError (instead of
 * exiting) on parse failure, carrying the command's help printer.
 *
 * @param {{options: object, allowPositionals: boolean, help: () => void}} command
 * @param {string[]} argv
 * @returns {{values: object, positionals: string[]}}
 */
export function parseCommandArgs(command, argv) {
  try {
    return parseArgs({
      args: argv,
      options: command.options,
      allowPositionals: command.allowPositionals,
      strict: false,
    });
  } catch (err) {
    throw new UsageError(`Error parsing arguments: ${err.message}`, { showHelp: command.help });
  }
}

/**
 * Resolve argv[0] to a command + the remaining argv for that command.
 * Only `convert` is a recognized subcommand name; anything else (including
 * flags, a bare path, or a directory that happens to be named "convert" —
 * unchanged from the CLI's pre-existing behavior) falls through to the
 * default viewer command with the full argv.
 *
 * @param {string[]} argv
 * @returns {{command: object, argv: string[]}}
 */
export function resolveCommand(argv) {
  const [maybeName, ...rest] = argv;
  if (Object.hasOwn(commands, maybeName)) {
    return { command: commands[maybeName], argv: rest };
  }
  return { command: defaultCommand, argv };
}

/**
 * Parse argv, resolve to a command, and run it.
 * @param {string[]} argv
 * @returns {Promise<number|undefined>}
 */
export async function dispatch(argv) {
  const { command, argv: commandArgv } = resolveCommand(argv);
  const parsed = parseCommandArgs(command, commandArgv);
  return command.run(parsed);
}

export default dispatch;
