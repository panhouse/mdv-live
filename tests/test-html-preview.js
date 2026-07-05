/**
 * Tests for HTML Preview Feature
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { getFileType } from '../src/utils/fileTypes.js';
import { startTestServer } from './helpers/server.js';

const INDEX_HTML = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Test HTML</h1>
  <script src="script.js"></script>
</body>
</html>`;

describe('HTML Preview Feature', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer({
      files: {
        'index.html': INDEX_HTML,
        'styles.css': `body { color: red; }`,
        'script.js': `console.log('hello');`,
        'subdir/page.html': `<html><body>Sub page</body></html>`,
        'subdir/page.htm': `<html><body>HTM page</body></html>`,
      },
    });
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
  });

  describe('File Type Detection', () => {
    it('should detect .html as html type', () => {
      const fileType = getFileType('index.html');
      assert.strictEqual(fileType.type, 'html');
      assert.strictEqual(fileType.icon, 'html');
      assert.strictEqual(fileType.lang, 'html');
      assert.strictEqual(fileType.binary, false);
    });

    it('should detect .htm as html type', () => {
      const fileType = getFileType('page.htm');
      assert.strictEqual(fileType.type, 'html');
      assert.strictEqual(fileType.icon, 'html');
    });
  });

  describe('GET /api/file for HTML', () => {
    it('should return htmlUrl for HTML files', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=index.html`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.fileType, 'html');
      assert.strictEqual(data.icon, 'html');
      assert.ok(data.htmlUrl);
      assert.strictEqual(data.htmlUrl, '/raw/index.html');
      assert.ok(data.content); // Escaped HTML for code view
      assert.ok(data.raw);     // Raw HTML for editing
    });

    it('should return htmlUrl for .htm files', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=subdir/page.htm`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.fileType, 'html');
      assert.strictEqual(data.htmlUrl, '/raw/subdir/page.htm');
    });

    it('should escape HTML content for code view', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=index.html`);
      const data = await response.json();

      // Content should have escaped HTML
      assert.ok(data.content.includes('&lt;'));
      assert.ok(data.content.includes('&gt;'));
      assert.ok(data.content.includes('language-html'));
    });

    it('should preserve raw HTML content', async () => {
      const response = await fetch(`${ctx.baseUrl}/api/file?path=index.html`);
      const data = await response.json();

      // Raw should have unescaped HTML
      assert.ok(data.raw.includes('<html>'));
      assert.ok(data.raw.includes('</html>'));
    });
  });

  describe('GET /raw/* endpoint', () => {
    it('should serve HTML files with correct content type', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/index.html`);
      assert.strictEqual(response.status, 200);

      const contentType = response.headers.get('content-type');
      assert.ok(contentType.includes('text/html'));

      const body = await response.text();
      assert.ok(body.includes('<h1>Test HTML</h1>'));
    });

    it('should serve CSS files referenced by HTML', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/styles.css`);
      assert.strictEqual(response.status, 200);

      const contentType = response.headers.get('content-type');
      assert.ok(contentType.includes('text/css'));

      const body = await response.text();
      assert.ok(body.includes('color: red'));
    });

    it('should serve JS files referenced by HTML', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/script.js`);
      assert.strictEqual(response.status, 200);

      const contentType = response.headers.get('content-type');
      assert.ok(contentType.includes('javascript'));
    });

    it('should serve files from subdirectories', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/subdir/page.html`);
      assert.strictEqual(response.status, 200);

      const body = await response.text();
      assert.ok(body.includes('Sub page'));
    });

    it('should return 404 for non-existent files', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/nonexistent.html`);
      assert.strictEqual(response.status, 404);
    });

    it('should reject path traversal attempts', async () => {
      // Note: Express normalizes paths like /../../../ to /, so we test with encoded path
      // The important thing is that the file is not accessible
      const response = await fetch(`${ctx.baseUrl}/raw/test%2F..%2F..%2F..%2Fetc%2Fpasswd`);
      // Should return 403 (Access denied) because validatePath rejects '..'
      assert.strictEqual(response.status, 403);
    });

    it('should reject absolute paths', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw//etc/passwd`);
      assert.strictEqual(response.status, 403);
    });

    it('should reject paths with null bytes', async () => {
      const response = await fetch(`${ctx.baseUrl}/raw/index.html%00.txt`);
      assert.strictEqual(response.status, 403);
    });
  });
});
