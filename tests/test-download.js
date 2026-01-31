/**
 * Tests for Download API
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMdvServer } from '../src/server.js';

// Minimal valid 1x1 PNG image (67 bytes)
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59,
  0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('Download API', () => {
  let server;
  let tempDir;
  const PORT = 19995;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-download-test-'));

    await Promise.all([
      fs.writeFile(path.join(tempDir, 'test.txt'), 'test content'),
      fs.writeFile(path.join(tempDir, 'test.md'), '# Markdown'),
      fs.writeFile(path.join(tempDir, 'test.png'), MINIMAL_PNG),
    ]);

    server = createMdvServer({ rootDir: tempDir, port: PORT });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/download', () => {
    it('should download text file', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/download?path=test.txt`);
      assert.strictEqual(response.status, 200);

      const content = await response.text();
      assert.strictEqual(content, 'test content');
    });

    it('should download markdown file', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/download?path=test.md`);
      assert.strictEqual(response.status, 200);

      const content = await response.text();
      assert.strictEqual(content, '# Markdown');
    });

    it('should download binary file (image)', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/download?path=test.png`);
      assert.strictEqual(response.status, 200);

      const buffer = await response.arrayBuffer();
      assert.ok(buffer.byteLength > 0);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/download?path=nonexistent.txt`);
      assert.strictEqual(response.status, 404);
    });

    it('should return 400 without path parameter', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/download`);
      assert.strictEqual(response.status, 400);
    });
  });

  describe('Binary File Handling', () => {
    it('should return image info for image files', async () => {
      const response = await fetch(`http://localhost:${PORT}/api/file?path=test.png`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.fileType, 'image');
      assert.ok(data.imageUrl || data.downloadUrl);
    });
  });
});
