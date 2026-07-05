/**
 * Tests for src/rendering/markdown.js's `data-source-line` mapping — the
 * shared foundation for search-jump (0.6.1) and diff-highlight (0.6.3).
 *
 * renderMarkdown() is a pure function (string in, HTML string out), so these
 * are direct unit tests with no server needed (see tests/test-save-queue.js
 * for the same convention).
 *
 * Attribute contract (see src/rendering/markdown.js's "Source-line mapping"
 * comment for the full rationale):
 *   - Attributed with the 1-based ORIGINAL RAW FILE line the block starts
 *     at: headings (h1-h6), paragraphs, fenced/indented code blocks (the
 *     attribute lands on the inner <code>, not <pre> — a markdown-it
 *     default-renderer quirk, see below), <hr>, and table row-level
 *     elements (<thead>/<tbody>/<tr> — NOT <table> itself, see below).
 *   - Mermaid blocks (which bypass markdown-it's tokenizer entirely via a
 *     placeholder-swap guard) get data-source-line baked directly onto the
 *     restored <pre> wrapper, pointing at the ```mermaid fence's line.
 *   - Deliberately NOT attributed: <ul>/<ol>/<li>/<blockquote>/<table>
 *     (their opening tags). Attributing any of these would break
 *     pre-existing exact-string assertions in test-markdown-rendering.js
 *     (`.includes('<table>')` etc.) that must keep passing unmodified.
 *     Blockquotes/loose-list items still surface a line via their inner
 *     (non-hidden) <p>; tight list items (the common case) get no
 *     data-source-line anywhere inside them at all — a known, deliberate
 *     gap, not an oversight.
 *   - YAML frontmatter (converted to a synthetic ```yaml fence) and each
 *     ```mermaid block correctly shift the line count of the content
 *     markdown-it actually parses; data-source-line always reports the
 *     line in the *original* file, not that intermediate content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderMarkdown } from '../src/rendering/markdown.js';

describe('Source-line mapping (data-source-line)', () => {
  describe('multi-block fixture (blank lines + fenced block)', () => {
    // 1-based raw line numbers:
    // 1  # Title
    // 2  (blank)
    // 3  Paragraph one.
    // 4  still para one
    // 5  (blank)
    // 6  - item a
    // 7  - item b
    // 8  (blank)
    // 9  > a quote
    // 10 (blank)
    // 11 ```js
    // 12 code();
    // 13 ```
    // 14 (blank)
    // 15 | H1 | H2 |
    // 16 |----|----|
    // 17 | a  | b  |
    const src = [
      '# Title',
      '',
      'Paragraph one.',
      'still para one',
      '',
      '- item a',
      '- item b',
      '',
      '> a quote',
      '',
      '```js',
      'code();',
      '```',
      '',
      '| H1 | H2 |',
      '|----|----|',
      '| a  | b  |'
    ].join('\n');
    const html = renderMarkdown(src);

    it('tags the heading with its 1-based source line', () => {
      assert.ok(html.includes('<h1 data-source-line="1">Title</h1>'));
    });

    it('tags a multi-line paragraph with its starting line (not a continuation line)', () => {
      assert.ok(html.includes('data-source-line="3"'));
      assert.ok(/<p data-source-line="3">Paragraph one\.<br>\s*still para one<\/p>/.test(html));
    });

    it('tags the fenced code block on its <code> element with the fence-open line', () => {
      // markdown-it's default fence renderer places attrs on <code>, not <pre>
      // (see the "Source-line mapping" note) — assert that placement exactly.
      assert.ok(html.includes('<pre><code data-source-line="11" class="language-js">'));
    });

    it('tags table rows (thead/tbody/tr) at row granularity, not just the table', () => {
      assert.ok(html.includes('<thead data-source-line="15">'));
      assert.ok(html.includes('<tr data-source-line="15">'));
      assert.ok(html.includes('<tbody data-source-line="17">'));
      assert.ok(html.includes('<tr data-source-line="17">'));
    });

    it('does NOT attribute <ul>/<li>/<blockquote>/<table> themselves (existing bare-tag tests)', () => {
      assert.ok(html.includes('<ul>\n<li>item a</li>\n<li>item b</li>\n</ul>'));
      assert.ok(html.includes('<blockquote>\n<p data-source-line="9">a quote</p>\n</blockquote>'));
      assert.ok(html.includes('<table>\n'));
    });
  });

  describe('YAML frontmatter shifts subsequent line numbers correctly', () => {
    // 1 ---
    // 2 title: Test
    // 3 author: Me
    // 4 ---
    // 5 (blank)
    // 6 # Content
    // 7 (blank)
    // 8 Second para
    const src = [
      '---',
      'title: Test',
      'author: Me',
      '---',
      '',
      '# Content',
      '',
      'Second para'
    ].join('\n');
    const html = renderMarkdown(src);

    it('tags the synthetic yaml fence at the frontmatter start line (1)', () => {
      assert.ok(html.includes('<pre><code data-source-line="1" class="language-yaml">'));
    });

    it('tags content after the frontmatter block at its correct RAW line, not the shifted one', () => {
      // The frontmatter+blank-line block collapses from 5 raw lines to 4
      // rendered lines; without shift-correction "# Content" would be
      // mis-tagged 5 instead of 6.
      assert.ok(html.includes('<h1 data-source-line="6">Content</h1>'));
      assert.ok(html.includes('<p data-source-line="8">Second para</p>'));
    });
  });

  describe('Mermaid blocks', () => {
    it('still renders the guard structure unchanged (pre > code.language-mermaid)', () => {
      const html = renderMarkdown('```mermaid\ngraph TD\n    A --> B\n```');
      assert.ok(html.includes('<code class="language-mermaid">'));
      assert.ok(/<pre[^>]*><code class="language-mermaid">/.test(html));
    });

    it('gains a data-source-line on the restored <pre> pointing at the fence-open line', () => {
      const src = [
        'intro',
        '',
        '```mermaid',
        'graph TD',
        'A --> B',
        '```',
        '',
        '# After'
      ].join('\n');
      const html = renderMarkdown(src);
      assert.ok(html.includes('<pre data-source-line="3"><code class="language-mermaid">'));
      // and content after the (multi-line, now-collapsed) block still gets
      // its correct raw line, not the shifted one.
      assert.ok(html.includes('<h1 data-source-line="8">After</h1>'));
    });

    it('assigns each of multiple mermaid blocks its own correct fence-open line', () => {
      const src = [
        'a',                  // 1
        '',                   // 2
        '```mermaid',         // 3
        'X',                  // 4
        '```',                // 5
        '',                   // 6
        'b',                  // 7
        '',                   // 8
        '```mermaid',         // 9
        'Y',                  // 10
        '```'                 // 11
      ].join('\n');
      const html = renderMarkdown(src);
      assert.ok(html.includes('<pre data-source-line="3"><code class="language-mermaid">X</code></pre>'));
      assert.ok(html.includes('<pre data-source-line="9"><code class="language-mermaid">Y</code></pre>'));
    });

    it('does not break when frontmatter AND a mermaid block are both present (composed shift)', () => {
      const src = [
        '---',            // 1
        'marp: false',    // 2
        '---',            // 3
        '',               // 4
        '# Heading',      // 5
        '',               // 6
        '```mermaid',     // 7
        'A-->B',          // 8
        '```',            // 9
        '',               // 10
        'tail para'       // 11
      ].join('\n');
      const html = renderMarkdown(src);
      assert.ok(html.includes('<h1 data-source-line="5">Heading</h1>'));
      assert.ok(html.includes('<pre data-source-line="7"><code class="language-mermaid">A--&gt;B</code></pre>'));
      assert.ok(html.includes('<p data-source-line="11">tail para</p>'));
    });
  });

  describe('CRLF line endings', () => {
    it('counts \\r\\n as a single line break (matches markdown-it\'s own normalization)', () => {
      const src = '# Title\r\n\r\nPara one\r\n\r\n```mermaid\r\nA\r\n```\r\n\r\n# After';
      const html = renderMarkdown(src);
      assert.ok(html.includes('<h1 data-source-line="1">Title</h1>'));
      assert.ok(html.includes('<p data-source-line="3">Para one</p>'));
      // Note: MERMAID_PATTERN's `\n\`\`\`` closing match (pre-existing, not
      // introduced here) leaves a trailing \r inside the captured code on
      // CRLF input — unrelated to source-line mapping, so only the fence's
      // data-source-line (this feature) is asserted here, not the content.
      assert.ok(html.includes('<pre data-source-line="5"><code class="language-mermaid">A'));
      assert.ok(html.includes('<h1 data-source-line="9">After</h1>'));
    });
  });

  describe('existing snapshot-ish assertions remain green (no regression)', () => {
    it('still preserves multiple mermaid blocks (count check from test-markdown-rendering.js)', () => {
      const html = renderMarkdown('```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```');
      const matches = html.match(/language-mermaid/g);
      assert.strictEqual(matches.length, 2);
    });

    it('still renders headings/lists/blockquotes/tables as bare tags where previously bare', () => {
      const html = renderMarkdown('- Item 1\n- Item 2\n\n1. First\n2. Second');
      assert.ok(html.includes('<ul>'));
      assert.ok(html.includes('<li>'));
      assert.ok(html.includes('<ol>'));
    });
  });
});
