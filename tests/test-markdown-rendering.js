/**
 * Markdown Rendering Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

import { startTestServer } from './helpers/server.js';

describe('Markdown Rendering', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    if (ctx) {
      await ctx.stop();
    }
  });

  /**
   * Creates a file and fetches its rendered content via API
   * @param {string} filename - Name of the file to create
   * @param {string} content - Content to write to the file
   * @returns {Promise<object>} Parsed JSON response from API
   */
  async function createAndFetch(filename, content) {
    await fs.writeFile(path.join(ctx.rootDir, filename), content);
    const response = await fetch(`${ctx.baseUrl}/api/file?path=${filename}`);
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

    it('should render task list with CJK and bold', async () => {
      const data = await createAndFetch('tasks-cjk.md', '- [ ] **日本語の太字**テスト');
      assert.ok(data.content.includes('<strong>日本語の太字</strong>'));
    });
  });

  describe('Strikethrough', () => {
    it('should render strikethrough', async () => {
      const data = await createAndFetch('strike.md', 'This is ~~deleted~~ text');
      assert.ok(data.content.includes('<s>deleted</s>') || data.content.includes('<del>deleted</del>'));
      assert.ok(!data.content.includes('~~deleted~~'), 'raw ~~ must not appear');
    });
  });

  describe('CJK Emphasis', () => {
    it('should render bold adjacent to CJK punctuation', async () => {
      const data = await createAndFetch('cjk-paren.md', '（**強調**）');
      assert.ok(data.content.includes('<strong>強調</strong>'));
    });

    it('should render bold between CJK text', async () => {
      const data = await createAndFetch('cjk-text.md', 'これは**太字**です');
      assert.ok(data.content.includes('<strong>太字</strong>'));
    });

    it('should render bold after CJK brackets', async () => {
      const data = await createAndFetch('cjk-bracket.md', '「**重要**」：確認');
      assert.ok(data.content.includes('<strong>重要</strong>'));
    });
  });

  describe('Linkify', () => {
    it('should auto-link URLs', async () => {
      const data = await createAndFetch('linkify.md', 'Visit https://example.com for more');
      assert.ok(data.content.includes('href="https://example.com"'));
    });
  });

  describe('Line Breaks', () => {
    it('should convert single newline to br', async () => {
      const data = await createAndFetch('breaks.md', 'Line 1\nLine 2');
      assert.ok(data.content.includes('<br>') || data.content.includes('<br />'));
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
    it('should skip empty frontmatter', async () => {
      const data = await createAndFetch('empty-fm.md', '---\n\n---\n\nbody');
      assert.ok(!data.content.includes('language-yaml'), 'empty frontmatter should not create yaml code block');
      assert.ok(data.content.includes('body'));
    });

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

    it('should handle multiple mermaid blocks', async () => {
      const content = '```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```';
      const data = await createAndFetch('mermaid-multi.md', content);
      const matches = data.content.match(/language-mermaid/g);
      assert.strictEqual(matches.length, 2, 'should have 2 mermaid blocks');
    });

    it('should not be affected by user placeholder text', async () => {
      const content = 'text with <!--MERMAID_PLACEHOLDER_0--> in it\n\n```mermaid\ngraph TD\n```';
      const data = await createAndFetch('mermaid-inject.md', content);
      assert.ok(data.content.includes('language-mermaid'), 'mermaid block should render');
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

  describe('Marp background images (![bg])', () => {
    // Regression: marp-core renders `![bg]` as
    // <figure style="background-image:url(&quot;path&quot;)">, not as <img>.
    // rewriteMediaPaths used to miss the CSS background-image form, so relative
    // ![bg] paths 404'd silently and the slide rendered blank.
    it('should rewrite a relative ![bg] path to /raw/', async () => {
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg](images/cover.png)',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('marp-bg.md', content);
      assert.strictEqual(data.isMarp, true);
      assert.ok(
        data.content.includes('background-image:url(&quot;/raw/images/cover.png&quot;)'),
        'relative ![bg] path must be rewritten to /raw/'
      );
    });

    it('should resolve a relative ![bg] path against the file directory', async () => {
      await fs.mkdir(path.join(ctx.rootDir, 'decks'), { recursive: true });
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg](pics/a.jpg)',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('decks/marp-bg-sub.md', content);
      assert.ok(
        data.content.includes('background-image:url(&quot;/raw/decks/pics/a.jpg&quot;)'),
        '![bg] path must be resolved relative to the source file directory'
      );
    });

    // Regression (codex-loop round 1, P2): the rewrite must read the quoted
    // URL to its closing quote, not to the first `)`. A filename containing
    // parentheses used to be cut mid-path (.../cover(1 + stray &quot;).png).
    it('should preserve parentheses in a ![bg] filename', async () => {
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg](images/cover(1).png)',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('marp-bg-parens.md', content);
      assert.ok(
        data.content.includes('background-image:url(&quot;/raw/images/cover(1).png&quot;)'),
        '![bg] filename with parentheses must be rewritten without truncation'
      );
    });

    it('should preserve a percent-encoded space in a ![bg] filename', async () => {
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg](<images/cover (1).png>)',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('marp-bg-space.md', content);
      assert.ok(
        data.content.includes('background-image:url(&quot;/raw/images/cover%20(1).png&quot;)'),
        '![bg] filename with an encoded space + parentheses must survive intact'
      );
    });

    // Regression (codex-loop round 2): the quoted branch uses `*?`, which
    // can match an empty URL. Marp drops `![bg]()` entirely (no figure), so
    // this just confirms an empty ![bg] renders without inventing a /raw/ URL.
    it('should not emit a spurious /raw/ URL for an empty ![bg]', async () => {
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg]()',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('marp-bg-empty.md', content);
      assert.strictEqual(data.isMarp, true);
      assert.ok(
        !data.content.includes('url(&quot;/raw/&quot;)'),
        'empty ![bg] must not be rewritten to an empty /raw/ URL'
      );
    });

    it('should leave an absolute-URL ![bg] untouched', async () => {
      const content = [
        '---',
        'marp: true',
        '---',
        '',
        '![bg](https://example.com/x.png)',
        '',
        '# Slide'
      ].join('\n');
      const data = await createAndFetch('marp-bg-url.md', content);
      assert.ok(
        data.content.includes('background-image:url(&quot;https://example.com/x.png&quot;)'),
        'absolute-URL ![bg] must not be rewritten'
      );
      assert.ok(
        !data.content.includes('/raw/https'),
        'absolute-URL ![bg] must not be prefixed with /raw/'
      );
    });
  });
});
