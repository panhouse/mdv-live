/**
 * Download Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createMdvServer } from '../src/server.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Download', () => {
  let server;
  let tempDir;
  const port = 19995;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-download-test-'));

    // Create test files
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'test content');
    await fs.writeFile(path.join(tempDir, 'test.md'), '# Markdown');

    // Create a minimal PNG image
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
      0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    await fs.writeFile(path.join(tempDir, 'test.png'), pngHeader);

    server = createMdvServer({ rootDir: tempDir, port });
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
      const response = await fetch(`http://localhost:${port}/api/download?path=test.txt`);
      assert.strictEqual(response.status, 200);

      const content = await response.text();
      assert.strictEqual(content, 'test content');
    });

    it('should download markdown file', async () => {
      const response = await fetch(`http://localhost:${port}/api/download?path=test.md`);
      assert.strictEqual(response.status, 200);

      const content = await response.text();
      assert.strictEqual(content, '# Markdown');
    });

    it('should download binary file (image)', async () => {
      const response = await fetch(`http://localhost:${port}/api/download?path=test.png`);
      assert.strictEqual(response.status, 200);

      const buffer = await response.arrayBuffer();
      assert.ok(buffer.byteLength > 0);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`http://localhost:${port}/api/download?path=nonexistent.txt`);
      assert.strictEqual(response.status, 404);
    });

    it('should return 400 without path parameter', async () => {
      const response = await fetch(`http://localhost:${port}/api/download`);
      assert.strictEqual(response.status, 400);
    });
  });

  describe('Binary File Handling', () => {
    it('should return image info for image files', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=test.png`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.fileType, 'image');
      assert.ok(data.imageUrl || data.downloadUrl);
    });
  });
});
