/**
 * Structured error used throughout src/cli/ to signal "the user did
 * something wrong, print a message (and optionally help), then exit
 * non-zero" — WITHOUT calling process.exit() directly.
 *
 * Every src/cli/ helper throws UsageError instead of exiting so it can be
 * unit-tested (calling process.exit() during a test run kills the test
 * process). bin/mdv.js's main() is the only place that catches UsageError
 * and turns it into an actual process.exit() call.
 *
 * `message` is the full, ready-to-print string (callers compose whatever
 * prefix is appropriate, e.g. "Error: ..." or "Error parsing arguments: ...")
 * so main() can print it verbatim and stay agnostic of call-site wording.
 */
export class UsageError extends Error {
  /**
   * @param {string} message - Full, ready-to-print error message.
   * @param {object} [options]
   * @param {number} [options.exitCode=1] - Process exit code main() should use.
   * @param {() => void} [options.showHelp] - Optional help printer to invoke before exiting.
   */
  constructor(message, { exitCode = 1, showHelp } = {}) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = exitCode;
    this.showHelp = showHelp;
  }
}

export default UsageError;
