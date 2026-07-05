/**
 * Shared server-bootstrap helper for integration tests that spin up a real
 * MDV HTTP server (createMdvServer) against a throwaway fixture directory.
 *
 * Replaces the copy-pasted boilerplate that used to live in 9 test files:
 *   - fileURLToPath/__dirname resolution
 *   - a hardcoded "magic" port (19995-19999, 18764, ...)
 *   - fs.mkdtemp + seed files + createMdvServer + before/after start()/stop()
 *
 * `node --test` runs test FILES in parallel by default, so this helper must
 * be collision-free across concurrently-running processes:
 *   - rootDir: a fresh fs.mkdtemp() fixture directory per call.
 *   - port: an OS-assigned ephemeral port, discovered via the classic
 *     net.createServer(0) "probe" trick and then handed to createMdvServer
 *     *explicitly* as a real number.
 *
 * Why not just pass `port: 0` to createMdvServer and let Node pick?
 * src/api/marpNote.js builds its Origin/Host allow-list as
 * `options.port || 8080` -- a literal `0` is falsy, so it would silently fall
 * back to allow-listing port 8080 while the server actually listens on a
 * different OS-assigned port, breaking the Origin/Host guard for any request
 * whose Host header matches the real (non-8080) port. Pre-resolving a free
 * port ourselves and passing that concrete number avoids the footgun without
 * touching src/.
 */

import { createServer as createNetServer } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMdvServer } from '../../src/server.js';

/**
 * Ask the OS for a currently-free TCP port.
 *
 * Binds with no explicit host (same as createMdvServer's `server.listen(port)`
 * call) so the probe reserves the port against the same interface set the
 * real server will bind to. There is an inherent, tiny TOCTOU window between
 * closing this probe socket and createMdvServer binding the same port --
 * acceptable for test infra (the same trick used by the `get-port` package).
 *
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Write a flat map of `{ relativePath: content }` into rootDir, creating
 * parent directories as needed.
 *
 * - `content` may be a string or a Buffer (binary fixtures, e.g. PNGs).
 * - A `null`/`undefined` content, or a `relativePath` ending in `/`, creates
 *   an (empty) directory instead of a file -- useful for seeding an empty
 *   subdirectory a test expects to already exist.
 *
 * @param {string} rootDir
 * @param {Record<string, string|Buffer|null|undefined>} files
 */
async function seedFiles(rootDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath);
    if (relativePath.endsWith('/') || content === null || content === undefined) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

/**
 * Start a real MDV server against a throwaway fs.mkdtemp() fixture directory.
 *
 * @param {Object} [options]
 * @param {Record<string, string|Buffer|null|undefined>} [options.files] - seed files/dirs, written before the server starts
 * @param {number} [options.depth] - forwarded to createMdvServer (directory watch depth)
 * @returns {Promise<{
 *   baseUrl: string,
 *   port: number,
 *   rootDir: string,
 *   server: ReturnType<typeof createMdvServer>,
 *   stop: () => Promise<void>
 * }>}
 */
export async function startTestServer({ files = {}, depth } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-test-'));
  await seedFiles(rootDir, files);

  const port = await getFreePort();
  const server = createMdvServer({
    rootDir,
    port,
    ...(depth !== undefined ? { depth } : {}),
  });
  await server.start();

  const baseUrl = `http://localhost:${port}`;

  async function stop() {
    await server.stop();
    await fs.rm(rootDir, { recursive: true, force: true });
  }

  return { baseUrl, port, rootDir, server, stop };
}

export default startTestServer;
