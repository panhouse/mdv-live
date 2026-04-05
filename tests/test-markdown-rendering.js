/**
 * Markdown Rendering Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMdvServer } from '../src/server.js';

const TEST_PORT = 19996;

describe('Markdown Rendering', () => {
  let server;
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdv-render-test-'));
    server = createMdvServer({ rootDir: tempDir, port: TEST_PORT });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Creates a file and fetches its rendered content via API
   * @param {string} filename - Name of the file to create
   * @param {string} content - Content to write to the file
   * @returns {Promise<object>} Parsed JSON response from API
   */
  async function createAndFetch(filename, content) {
    await fs.writeFile(path.join(tempDir, filename), content);
    const response = await fetch(`http://localhost:${TEST_PORT}/api/file?path=${filename}`);
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

  describe('Task Lists', () => {
    it('should render task list checkboxes', async () => {
      const data = await createAndFetch('tasks.md', '- [ ] todo\n- [x] done');
      assert.ok(data.content.includes('type="checkbox"'));
      assert.ok(data.content.includes('class="task-list-item'));
    });

    it('should render inline markdown inside task list items without leaking raw source', async () => {
      const source = '- [ ] **bold** and [link](https://example.com) and `code`';
      const data = await createAndFetch('tasks-inline.md', source);
      // Inline markdown must be rendered
      assert.ok(data.content.includes('<strong>bold</strong>'));
      assert.ok(data.content.includes('href="https://example.com"'));
      assert.ok(data.content.includes('<code>code</code>'));
      // Raw markdown source must NOT appear in the output
      assert.ok(!data.content.includes('**bold**'), 'raw **bold** must not appear');
      assert.ok(!data.content.includes('[link](https://example.com)'), 'raw link syntax must not appear');
      assert.ok(!data.content.includes('`code`'), 'raw backtick code must not appear');
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
      const content = [
        '---',
        'title: Test',
        'author: Me',
        '---',
        '',
        '# Content'
      ].join('\n');
      const data = await createAndFetch('frontmatter.md', content);
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
      const data = await createAndFetch('html-test.md', '<div class="custom">Content</div>');
      assert.ok(data.content.includes('custom') || data.content.includes('div'));
    });

    it('should handle special characters in code blocks', async () => {
      const codeContent = '```\n<script>alert("test")</script>\n```';
      const data = await createAndFetch('code-special.md', codeContent);
      assert.ok(data.content.includes('&lt;') || data.content.includes('script'));
    });
  });

  describe('Marp Detection', () => {
    it('should detect Marp files', async () => {
      const content = [
        '---',
        'marp: true',
        'theme: default',
        '---',
        '',
        '# Slide 1'
      ].join('\n');
      const data = await createAndFetch('marp-slide.md', content);
      assert.strictEqual(data.isMarp, true);
      assert.ok(data.css, 'Marp files should include CSS');
    });

    it('should NOT detect regular markdown as Marp', async () => {
      const content = [
        '# Regular Markdown',
        '',
        'This is not a Marp file.'
      ].join('\n');
      const data = await createAndFetch('regular.md', content);
      assert.strictEqual(data.isMarp, false);
    });

    it('should NOT detect Marp in code examples', async () => {
      const content = [
        '# README',
        '',
        'Example:',
        '',
        '```markdown',
        '---',
        'marp: true',
        '---',
        '```'
      ].join('\n');
      const data = await createAndFetch('marp-example.md', content);
      assert.strictEqual(data.isMarp, false);
    });
  });
});
