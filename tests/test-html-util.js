/**
 * src/utils/html.js — canonical escapeHtml (5-entity set).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { escapeHtml } from '../src/utils/html.js';

describe('escapeHtml', () => {
  it('escapes all 5 canonical entities', () => {
    assert.strictEqual(
      escapeHtml(`& < > " '`),
      '&amp; &lt; &gt; &quot; &#x27;'
    );
  });

  it('leaves safe text untouched', () => {
    assert.strictEqual(escapeHtml('hello world 123'), 'hello world 123');
  });

  it('handles repeated and mixed entities', () => {
    assert.strictEqual(
      escapeHtml('<script>alert("x&y")</script>'),
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;'
    );
  });

  it('handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });

  it('escapes single quotes (a gap in the 3-entity variant it replaces)', () => {
    assert.strictEqual(escapeHtml("it's"), 'it&#x27;s');
  });
});
