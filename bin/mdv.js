#!/usr/bin/env node

/**
 * MDV CLI - Markdown Viewer with Marp support
 *
 * Thin entry point: parse argv, dispatch to src/cli/registry.js, and be the
 * ONLY place that calls process.exit(). All command logic (subcommand
 * routing, arg parsing, viewer startup, convert orchestration, server
 * discovery, config loading) lives in src/cli/ and is exported there for
 * unit testing without spawning a subprocess.
 */

import { dispatch, UsageError } from '../src/cli/registry.js';

async function main() {
  const argv = process.argv.slice(2);
  let exitCode;
  try {
    exitCode = await dispatch(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      err.showHelp?.();
      exitCode = err.exitCode;
    } else {
      console.error('Error:', err.message);
      exitCode = 1;
    }
  } finally {
    // `undefined` means "keep the process alive" (the viewer command
    // started a server that holds the event loop open until Ctrl+C).
    if (typeof exitCode === 'number') {
      process.exit(exitCode);
    }
  }
}

main();
