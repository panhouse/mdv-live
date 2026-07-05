/**
 * Shared helpers for mdv-live E2E characterization tests.
 *
 * Each spec file boots its OWN server against its OWN fs.mkdtemp fixture
 * directory (see per-spec beforeAll/afterAll). Ports are never hardcoded —
 * suites may run concurrently — so we ask node:net for a free ephemeral
 * port first, then hand that exact number to createMdvServer.
 *
 * Why not port: 0? createMdvServer's start() resolves with the *requested*
 * `port` option (a closure variable captured at call time), not the value
 * actually bound by the OS via `server.address().port`. Passing port: 0
 * would make start() resolve with `{ port: 0 }` even though the OS bound a
 * real ephemeral port under the hood — there is no way to recover the real
 * bound port from the returned object. So we pre-select a free port
 * ourselves and pass that fixed number in, instead of relying on port: 0.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createMdvServer } from '../../src/server.js';

/**
 * Find a free TCP port on localhost.
 * @returns {Promise<number>}
 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Create a fresh temp directory for a spec's fixture files.
 * @param {string} [prefix]
 * @returns {Promise<string>} absolute path to the created directory
 */
export async function makeFixtureDir(prefix = 'mdv-e2e-') {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/**
 * Write a map of { relativePath: content } into rootDir, creating parent
 * directories as needed.
 * @param {string} rootDir
 * @param {Record<string,string>} files
 */
export async function seedFiles(rootDir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(rootDir, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
}

/**
 * Boot a real mdv-live server rooted at rootDir on a freshly-found free
 * port.
 * @param {string} rootDir
 * @returns {Promise<{ port: number, baseURL: string, mdv: ReturnType<typeof createMdvServer>, stop: () => Promise<void> }>}
 */
export async function startServer(rootDir) {
  const port = await findFreePort();
  const mdv = createMdvServer({ rootDir, port, depth: 3 });
  await mdv.start();
  const baseURL = `http://localhost:${port}`;
  return {
    port,
    baseURL,
    mdv,
    async stop() {
      await mdv.stop();
    }
  };
}

/**
 * Best-effort recursive removal of a fixture directory.
 * @param {string} dir
 */
export async function removeFixtureDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Build the content of a minimal Marp deck with `count` slides, each
 * carrying exactly one single-line speaker-note HTML comment (so
 * notesMultiplicity stays <= 1 and the inline notes panel is editable).
 * @param {string[]} notes - one note string per slide
 * @returns {string}
 */
export function buildMarpDeck(notes) {
  const slides = notes.map((note, i) => `# Slide ${i + 1}\n\n<!-- ${note} -->`);
  return `---\nmarp: true\n---\n\n${slides.join('\n\n---\n\n')}\n`;
}
