/**
 * File Operations Tests - Save, Delete, Mkdir, Move
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createMdvServer } from '../src/server.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('File Operations', () => {
  let server;
  let tempDir;
  const port = 19997;

  before(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-test-'));

    // Create test files
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Hello\n\nThis is a test.');
    await fs.writeFile(path.join(tempDir, 'test.py'), "print('hello')");
    await fs.mkdir(path.join(tempDir, 'subdir'));
    await fs.writeFile(path.join(tempDir, 'subdir', 'nested.md'), '# Nested');

    server = createMdvServer({ rootDir: tempDir, port });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/file', () => {
    it('should return markdown file content', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=README.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'README.md');
      assert.strictEqual(data.fileType, 'markdown');
      assert.ok(data.content.includes('<h1'));
      assert.ok(data.raw.includes('# Hello'));
    });

    it('should return code file content', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=test.py`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'test.py');
      assert.strictEqual(data.fileType, 'code');
    });

    it('should return nested file content', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=subdir/nested.md`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'nested.md');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=nonexistent.md`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/file (Save)', () => {
    it('should save file content', async () => {
      const newContent = '# Updated\n\nNew content here.';
      const response = await fetch(`http://localhost:${port}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'README.md', content: newContent })
      });
      assert.strictEqual(response.status, 200);

      // Verify file was updated
      const content = await fs.readFile(path.join(tempDir, 'README.md'), 'utf-8');
      assert.strictEqual(content, newContent);

      // Restore original content
      await fs.writeFile(path.join(tempDir, 'README.md'), '# Hello\n\nThis is a test.');
    });

    it('should create new file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new-file.md', content: '# New File' })
      });
      assert.strictEqual(response.status, 200);

      // Verify file was created
      const exists = await fs.access(path.join(tempDir, 'new-file.md')).then(() => true).catch(() => false);
      assert.ok(exists);

      // Clean up
      await fs.unlink(path.join(tempDir, 'new-file.md'));
    });
  });

  describe('DELETE /api/file', () => {
    it('should delete file', async () => {
      // Create file to delete
      await fs.writeFile(path.join(tempDir, 'to_delete.md'), 'delete me');

      const response = await fetch(`http://localhost:${port}/api/file?path=to_delete.md`, {
        method: 'DELETE'
      });
      assert.strictEqual(response.status, 200);

      // Verify file was deleted
      const exists = await fs.access(path.join(tempDir, 'to_delete.md')).then(() => true).catch(() => false);
      assert.strictEqual(exists, false);
    });

    it('should delete directory recursively', async () => {
      // Create directory to delete
      await fs.mkdir(path.join(tempDir, 'to_delete_dir'));
      await fs.writeFile(path.join(tempDir, 'to_delete_dir', 'file.txt'), 'content');

      const response = await fetch(`http://localhost:${port}/api/file?path=to_delete_dir`, {
        method: 'DELETE'
      });
      assert.strictEqual(response.status, 200);

      // Verify directory was deleted
      const exists = await fs.access(path.join(tempDir, 'to_delete_dir')).then(() => true).catch(() => false);
      assert.strictEqual(exists, false);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`http://localhost:${port}/api/file?path=nonexistent.md`, {
        method: 'DELETE'
      });
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/mkdir', () => {
    it('should create directory', async () => {
      const response = await fetch(`http://localhost:${port}/api/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new_folder' })
      });
      assert.strictEqual(response.status, 200);

      // Verify directory was created
      const stats = await fs.stat(path.join(tempDir, 'new_folder'));
      assert.ok(stats.isDirectory());

      // Clean up
      await fs.rmdir(path.join(tempDir, 'new_folder'));
    });

    it('should create nested directories', async () => {
      const response = await fetch(`http://localhost:${port}/api/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/folder' })
      });
      assert.strictEqual(response.status, 200);

      // Verify directories were created
      const exists = await fs.access(path.join(tempDir, 'deep/nested/folder')).then(() => true).catch(() => false);
      assert.ok(exists);

      // Clean up
      await fs.rm(path.join(tempDir, 'deep'), { recursive: true });
    });
  });

  describe('POST /api/move', () => {
    it('should move/rename file', async () => {
      // Create file to move
      await fs.writeFile(path.join(tempDir, 'source.md'), 'source content');

      const response = await fetch(`http://localhost:${port}/api/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'source.md', destination: 'moved.md' })
      });
      assert.strictEqual(response.status, 200);

      // Verify move
      const sourceExists = await fs.access(path.join(tempDir, 'source.md')).then(() => true).catch(() => false);
      const destExists = await fs.access(path.join(tempDir, 'moved.md')).then(() => true).catch(() => false);
      assert.strictEqual(sourceExists, false);
      assert.ok(destExists);

      // Clean up
      await fs.unlink(path.join(tempDir, 'moved.md'));
    });
  });

  describe('GET /api/tree', () => {
    it('should return file tree', async () => {
      const response = await fetch(`http://localhost:${port}/api/tree`);
      assert.strictEqual(response.status, 200);

      const tree = await response.json();
      assert.ok(Array.isArray(tree));

      const names = tree.map(item => item.name);
      assert.ok(names.includes('README.md'));
      assert.ok(names.includes('subdir'));
    });
  });
});
