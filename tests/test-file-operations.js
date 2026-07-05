/**
 * File Operations Tests - Save, Delete, Mkdir, Move
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startTestServer } from './helpers/server.js';

/**
 * Check if a file or directory exists at the given path.
 */
async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

describe('File Operations', () => {
  let ctx;

  function apiUrl(endpoint) {
    return `${ctx.baseUrl}${endpoint}`;
  }

  function tempPath(...segments) {
    return path.join(ctx.rootDir, ...segments);
  }

  before(async () => {
    ctx = await startTestServer({
      files: {
        'README.md': '# Hello\n\nThis is a test.',
        'test.py': "print('hello')",
        'subdir/nested.md': '# Nested',
      },
    });
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
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
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
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
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ path: 'new-file.md', content: '# New File' }),
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('new-file.md'));
      assert.ok(exists);

      await fs.unlink(tempPath('new-file.md'));
    });

    it('should write through a symlink (target updated, link preserved)', async () => {
      // Regression guard: fs.writeFile followed symlinks, but a naive
      // atomicWrite(fullPath) rename would replace the LINK with a regular
      // file and leave the target untouched.
      await fs.writeFile(tempPath('link-target.md'), 'original');
      await fs.symlink('link-target.md', tempPath('link.md'));

      const response = await fetch(apiUrl('/api/file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ path: 'link.md', content: 'via symlink' }),
      });
      assert.strictEqual(response.status, 200);

      const targetContent = await fs.readFile(tempPath('link-target.md'), 'utf-8');
      assert.strictEqual(targetContent, 'via symlink', 'the symlink TARGET must receive the write');

      const linkStat = await fs.lstat(tempPath('link.md'));
      assert.ok(linkStat.isSymbolicLink(), 'the symlink itself must survive the save');

      await fs.unlink(tempPath('link.md'));
      await fs.unlink(tempPath('link-target.md'));
    });
  });

  describe('DELETE /api/file', () => {
    it('should delete file', async () => {
      await fs.writeFile(tempPath('to_delete.md'), 'delete me');

      const response = await fetch(apiUrl('/api/file?path=to_delete.md'), {
        method: 'DELETE',
        headers: { 'Sec-Fetch-Site': 'same-origin' },
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
        headers: { 'Sec-Fetch-Site': 'same-origin' },
      });
      assert.strictEqual(response.status, 200);

      const exists = await pathExists(tempPath('to_delete_dir'));
      assert.strictEqual(exists, false);
    });

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(apiUrl('/api/file?path=nonexistent.md'), {
        method: 'DELETE',
        headers: { 'Sec-Fetch-Site': 'same-origin' },
      });
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/mkdir', () => {
    it('should create directory', async () => {
      const response = await fetch(apiUrl('/api/mkdir'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
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
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
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
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
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
