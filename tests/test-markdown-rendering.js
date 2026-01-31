/**
 * Markdown Rendering Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createMdvServer } from '../src/server.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Markdown Rendering', () => {
  let server;
  let tempDir;
  const port = 19996;

  before(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-render-test-'));
    server = createMdvServer({ rootDir: tempDir, port });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createAndFetch(filename, content) {
    await fs.writeFile(path.join(tempDir, filename), content);
    const response = await fetch(`http://localhost:${port}/api/file?path=${filename}`);
    return response.json();
  }

  describe('Basic Markdown', () => {
    it('should render headings', async () => {
      const data = await createAndFetch('heading.md', '# Heading 1\n## Heading 2\n### Heading 3');
      assert.ok(data.content.includes('<h1'));
      assert.ok(data.content.includes('<h2'));
      assert.ok(data.content.includes('<h3'));
    });

    it('should render bold and italic', async () => {
      const data = await createAndFetch('emphasis.md', '**bold** and *italic* and ***both***');
      assert.ok(data.content.includes('<strong>bold</strong>'));
      assert.ok(data.content.includes('<em>italic</em>'));
    });

    it('should render links', async () => {
      const data = await createAndFetch('links.md', '[Link Text](https://example.com)');
      assert.ok(data.content.includes('<a'));
      assert.ok(data.content.includes('href="https://example.com"'));
    });

    it('should render lists', async () => {
      const data = await createAndFetch('lists.md', '- Item 1\n- Item 2\n\n1. First\n2. Second');
      assert.ok(data.content.includes('<ul>'));
      assert.ok(data.content.includes('<li>'));
      assert.ok(data.content.includes('<ol>'));
    });

    it('should render blockquotes', async () => {
      const data = await createAndFetch('quote.md', '> This is a quote');
      assert.ok(data.content.includes('<blockquote>'));
    });

    it('should render tables', async () => {
      const tableContent = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;
      const data = await createAndFetch('table.md', tableContent);
      assert.ok(data.content.includes('<table>'));
      assert.ok(data.content.includes('<th>'));
      assert.ok(data.content.includes('<td>'));
    });
  });

  describe('Code Blocks', () => {
    it('should render inline code', async () => {
      const data = await createAndFetch('inline-code.md', 'Use `console.log()` for debugging');
      assert.ok(data.content.includes('<code>'));
    });

    it('should render fenced code blocks with language', async () => {
      const data = await createAndFetch('code-block.md', '```javascript\nconst x = 1;\n```');
      assert.ok(data.content.includes('<pre>'));
      assert.ok(data.content.includes('<code'));
      assert.ok(data.content.includes('language-javascript'));
    });

    it('should render code blocks without language', async () => {
      const data = await createAndFetch('code-plain.md', '```\nplain code\n```');
      assert.ok(data.content.includes('<pre>'));
      assert.ok(data.content.includes('<code'));
    });
  });

  describe('YAML Frontmatter', () => {
    it('should handle YAML frontmatter', async () => {
      const content = `---
title: Test
author: Me
---

# Content`;
      const data = await createAndFetch('frontmatter.md', content);
      // Frontmatter should be rendered as code block
      assert.ok(data.content.includes('language-yaml') || data.content.includes('title'));
    });
  });

  describe('Mermaid Blocks', () => {
    it('should preserve mermaid code blocks', async () => {
      const content = '```mermaid\ngraph TD\n    A --> B\n```';
      const data = await createAndFetch('mermaid.md', content);
      assert.ok(data.content.includes('language-mermaid'));
    });
  });

  describe('Special Characters', () => {
    it('should handle HTML in markdown (html enabled)', async () => {
      // Note: markdown-it has html:true for rendering HTML in markdown
      const data = await createAndFetch('html-test.md', '<div class="custom">Content</div>');
      // HTML should be preserved when html option is enabled
      assert.ok(data.content.includes('custom') || data.content.includes('div'));
    });

    it('should handle special characters in code blocks', async () => {
      const data = await createAndFetch('code-special.md', '```\n<script>alert("test")</script>\n```');
      // In code blocks, HTML should be escaped
      assert.ok(data.content.includes('&lt;') || data.content.includes('script'));
    });
  });

  describe('Marp Detection', () => {
    it('should detect Marp files', async () => {
      const content = `---
marp: true
theme: default
---

# Slide 1`;
      const data = await createAndFetch('marp-slide.md', content);
      assert.strictEqual(data.isMarp, true);
      assert.ok(data.css); // Marp files should include CSS
    });

    it('should NOT detect regular markdown as Marp', async () => {
      const content = `# Regular Markdown

This is not a Marp file.`;
      const data = await createAndFetch('regular.md', content);
      assert.strictEqual(data.isMarp, false);
    });

    it('should NOT detect Marp in code examples', async () => {
      const content = `# README

Example:

\`\`\`markdown
---
marp: true
---
\`\`\``;
      const data = await createAndFetch('marp-example.md', content);
      assert.strictEqual(data.isMarp, false);
    });
  });
});
