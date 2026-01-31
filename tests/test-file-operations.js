/**
 * File Operations Tests - Save, Delete, Mkdir, Move
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMdvServer } from '../src/server.js';

/**
 * Check if a file or directory exists at the given path.
 */
async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

describe('File Operations', () => {
  let server;
  let tempDir;
  const PORT = 19997;

  function apiUrl(endpoint) {
    return `http://localhost:${PORT}${endpoint}`;
  }

  function tempPath(...segments) {
    return path.join(tempDir, ...segments);
  }

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-test-'));

    await Promise.all([
      fs.writeFile(tempPath('README.md'), '# Hello\n\nThis is a test.'),
      fs.writeFile(tempPath('test.py'), "print('hello')"),
      fs.mkdir(tempPath('subdir')),
    ]);
    await fs.writeFile(tempPath('subdir', 'nested.md'), '# Nested');

    server = createMdvServer({ rootDir: tempDir, port: PORT });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/file', () => {
    it('should return markdown file content', async () => {
      const response = await fetch(apiUrl('/api/file?path=README.md'));
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'README.md');
      assert.strictEqual(data.fileType, 'markdown');
      assert.ok(data.content.includes('<h1'));
      assert.ok(data.raw.includes('# Hello'));
    });

    it('should return code file content', async () => {
      const response = await fetch(apiUrl('/api/file?path=test.py'));
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'test.py');
      assert.strictEqual(data.fileType, 'code');
    });

    it('should return nested file content', async () => {
      const response = await fetch(apiUrl('/api/file?path=subdir/nested.md'));
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.name, 'nested.md');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(apiUrl('/api/file?path=nonexistent.md'));
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/file (Save)', () => {
    it('should save file content', async () => {
      const originalContent = '# Hello\n\nThis is a test.';
      const newContent = '# Updated\n\nNew content here.';

      const response = await fetch(apiUrl('/api/file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'README.md', content: newContent }),
      });
      assert.strictEqual(response.status, 200);

      const savedContent = await fs.readFile(tempPath('README.md'), 'utf-8');
      assert.strictEqual(savedContent, newContent);

      await fs.writeFile(tempPath('README.md'), originalContent);
    });

    it('should create new file', async () => {
      const response = await fetch(apiUrl('/api/file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new-file.md', content: '# New File' }),
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('new-file.md'));
      assert.ok(exists);

      await fs.unlink(tempPath('new-file.md'));
    });
  });

  describe('DELETE /api/file', () => {
    it('should delete file', async () => {
      await fs.writeFile(tempPath('to_delete.md'), 'delete me');

      const response = await fetch(apiUrl('/api/file?path=to_delete.md'), {
        method: 'DELETE',
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('to_delete.md'));
      assert.strictEqual(exists, false);
    });

    it('should delete directory recursively', async () => {
      await fs.mkdir(tempPath('to_delete_dir'));
      await fs.writeFile(tempPath('to_delete_dir', 'file.txt'), 'content');

      const response = await fetch(apiUrl('/api/file?path=to_delete_dir'), {
        method: 'DELETE',
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('to_delete_dir'));
      assert.strictEqual(exists, false);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(apiUrl('/api/file?path=nonexistent.md'), {
        method: 'DELETE',
      });
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/mkdir', () => {
    it('should create directory', async () => {
      const response = await fetch(apiUrl('/api/mkdir'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new_folder' }),
      });
      assert.strictEqual(response.status, 200);

      const stats = await fs.stat(tempPath('new_folder'));
      assert.ok(stats.isDirectory());

      await fs.rmdir(tempPath('new_folder'));
    });

    it('should create nested directories', async () => {
      const response = await fetch(apiUrl('/api/mkdir'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'deep/nested/folder' }),
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('deep', 'nested', 'folder'));
      assert.ok(exists);

      await fs.rm(tempPath('deep'), { recursive: true });
    });
  });

  describe('POST /api/move', () => {
    it('should move/rename file', async () => {
      await fs.writeFile(tempPath('source.md'), 'source content');

      const response = await fetch(apiUrl('/api/move'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'source.md', destination: 'moved.md' }),
      });
      assert.strictEqual(response.status, 200);

      const [sourceExists, destExists] = await Promise.all([
        pathExists(tempPath('source.md')),
        pathExists(tempPath('moved.md')),
      ]);
      assert.strictEqual(sourceExists, false);
      assert.ok(destExists);

      await fs.unlink(tempPath('moved.md'));
    });
  });

  describe('GET /api/tree', () => {
    it('should return file tree', async () => {
      const response = await fetch(apiUrl('/api/tree'));
      assert.strictEqual(response.status, 200);

      const tree = await response.json();
      assert.ok(Array.isArray(tree));

      const names = tree.map((item) => item.name);
      assert.ok(names.includes('README.md'));
      assert.ok(names.includes('subdir'));
    });
  });
});
