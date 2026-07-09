/**
 * MDV - Marp diff→slide mapping (pure, DOM-free — see modules/
 * marpDiffIndicator.js for the manager that consumes this).
 *
 * GET /api/diff already reports `added`/`changed` as ONE-based inclusive
 * raw-line ranges (src/utils/lineDiff.js), and — for a Marp deck — a
 * `slideRanges` array in the SAME one-based inclusive convention (see
 * src/api/diff.js's docstring; the ranges are derived from
 * src/rendering/marpitAdapter.js's `parseDeck()`, the one place Marp/Marpit
 * parsing happens — never re-parsed here or anywhere else in the browser).
 * This module just intersects the two, so the frontend doesn't need a
 * second Marp parser to answer "does slide N contain a change".
 */

/**
 * @param {Array<[number, number]>} ranges - added/changed hunks, one-based
 *   inclusive [start, end] pairs.
 * @param {Array<{start: number, end: number}>} slideRanges - per-slide
 *   one-based inclusive line ranges, in slide order (index === slide index).
 * @returns {Set<number>} slide indices touched by at least one range.
 */
export function changedSlideIndices(ranges, slideRanges) {
    const indices = new Set();
    if (!Array.isArray(ranges) || !Array.isArray(slideRanges)) return indices;

    for (const range of ranges) {
        if (!Array.isArray(range) || range.length !== 2) continue;
        const [start, end] = range;
        for (let i = 0; i < slideRanges.length; i++) {
            const slide = slideRanges[i];
            if (!slide) continue;
            // Overlap test: the two closed intervals [start,end] and
            // [slide.start,slide.end] intersect.
            if (slide.start <= end && start <= slide.end) {
                indices.add(i);
            }
        }
    }
    return indices;
}
