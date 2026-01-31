/**
 * Simple slide renderer for Marp-compatible markdown
 *
 * Features:
 * - Split by --- (horizontal rule)
 * - Full HTML support (no escaping)
 * - Tailwind CSS compatible
 * - Frontmatter extraction
 */

import MarkdownIt from 'markdown-it';

// Initialize markdown-it with full HTML support
const md = new MarkdownIt({
  html: true,
  breaks: false,
  linkify: true,
  typographer: true
});

/**
 * Parse frontmatter from markdown content
 * @param {string} content - Raw markdown
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = {};
  const yaml = match[1];

  // Simple YAML parsing (key: value)
  yaml.split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      frontmatter[key.trim()] = rest.join(':').trim();
    }
  });

  return {
    frontmatter,
    body: content.slice(match[0].length)
  };
}

/**
 * Check if content is a slide presentation (has marp: true or uses ---)
 * @param {string} content - Markdown content
 * @returns {boolean}
 */
export function isSlidePresentation(content) {
  // Check for marp: true in frontmatter
  if (/^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/.test(content)) {
    return true;
  }
  return false;
}

/**
 * Render slide content (handles both HTML blocks and markdown)
 * @param {string} slideContent - Single slide content
 * @returns {string} Rendered HTML
 */
function renderSlideContent(slideContent) {
  const trimmed = slideContent.trim();

  // If it starts with HTML tag, render as-is (minimal processing)
  if (trimmed.startsWith('<')) {
    // Process any markdown within the HTML
    // But preserve the HTML structure
    return trimmed;
  }

  // Otherwise, render as markdown
  return md.render(trimmed);
}

/**
 * Extract scripts and styles from the first slide (typically config)
 * @param {string} content - First slide content after frontmatter
 * @returns {{ scripts: string, styles: string, content: string }}
 */
function extractConfigFromFirstSlide(content) {
  let scripts = '';
  let styles = '';
  let remaining = content;

  // Extract <script> tags
  const scriptMatches = content.match(/<script[\s\S]*?<\/script>/gi) || [];
  scriptMatches.forEach(script => {
    scripts += script + '\n';
    remaining = remaining.replace(script, '');
  });

  // Extract <style> tags
  const styleMatches = content.match(/<style[\s\S]*?<\/style>/gi) || [];
  styleMatches.forEach(style => {
    styles += style + '\n';
    remaining = remaining.replace(style, '');
  });

  return { scripts, styles, content: remaining.trim() };
}

/**
 * Render markdown slides to HTML
 * @param {string} content - Markdown content with slide separators
 * @returns {{ html: string, slideCount: number, scripts: string, styles: string }}
 */
export function renderSlides(content) {
  const { frontmatter, body } = parseFrontmatter(content);

  // Split by --- (must be on its own line)
  const rawSlides = body.split(/\n---\s*\n/);

  // Extract scripts/styles from first "slide" (config area)
  const firstSlide = rawSlides[0] || '';
  const { scripts, styles, content: firstContent } = extractConfigFromFirstSlide(firstSlide);

  // Build slides array (first slide might be empty after extracting config)
  const slidesContent = [firstContent, ...rawSlides.slice(1)].filter(s => s.trim());

  // Render each slide
  const slides = slidesContent.map((slideContent, index) => {
    const rendered = renderSlideContent(slideContent);
    return `
      <section class="slide" data-slide-index="${index}">
        ${rendered}
      </section>
    `;
  });

  // Wrap in container
  const html = `
    <div class="slides-container" data-slide-count="${slides.length}">
      ${slides.join('\n')}
    </div>
  `;

  return {
    html,
    slideCount: slides.length,
    scripts,
    styles,
    frontmatter
  };
}

export default { renderSlides, isSlidePresentation };
