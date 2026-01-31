/**
 * Tests for Marp detection logic
 *
 * Validates that the MARP_PATTERN correctly identifies Marp presentations
 * based on frontmatter position and content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Pattern must match: frontmatter at file start with marp: true
const MARP_PATTERN = /^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/;

function isMarp(content) {
  return MARP_PATTERN.test(content);
}

describe('Marp Detection', () => {
  describe('Valid Marp files', () => {
    it('should detect valid Marp frontmatter at file start', () => {
      const content = `---
marp: true
theme: default
---

# Slide 1
`;
      assert.strictEqual(isMarp(content), true);
    });

    it('should detect Marp with other frontmatter fields', () => {
      const content = `---
title: My Presentation
marp: true
paginate: true
---

# Slide 1
`;
      assert.strictEqual(isMarp(content), true);
    });

    it('should detect Marp with extra whitespace in value', () => {
      const content = `---
marp:   true
---

# Slide
`;
      assert.strictEqual(isMarp(content), true);
    });
  });

  describe('Invalid Marp files', () => {
    it('should NOT detect Marp in code blocks', () => {
      const content = `# README

Example Marp file:

\`\`\`markdown
---
marp: true
---
# Slide
\`\`\`
`;
      assert.strictEqual(isMarp(content), false);
    });

    it('should NOT detect Marp when frontmatter is not at start', () => {
      const content = `# Title

Some text

---
marp: true
---
`;
      assert.strictEqual(isMarp(content), false);
    });

    it('should NOT detect regular markdown without Marp', () => {
      const content = `# Regular Markdown

This is just a regular markdown file.

- Item 1
- Item 2
`;
      assert.strictEqual(isMarp(content), false);
    });

    it('should NOT detect frontmatter without marp: true', () => {
      const content = `---
title: Not Marp
author: Someone
---

# Regular document
`;
      assert.strictEqual(isMarp(content), false);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      assert.strictEqual(isMarp(''), false);
    });

    it('should handle content with only frontmatter delimiters', () => {
      const content = `---
---
`;
      assert.strictEqual(isMarp(content), false);
    });
  });
});
