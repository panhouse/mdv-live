/**
 * Pure math for the Marp slide zoom (src/static/app.js → MarpZoom).
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also still sets `globalThis.MDVMarpZoom`
 * for any not-yet-migrated code that reads the global directly. Kept
 * DOM-free so the contain/clamp logic — the part that decides whether the
 * whole slide stays visible — can be unit-tested without a browser (see
 * tests/test-marp-zoom.js).
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

// Per-wheel-delta zoom sensitivity. Pinch deltas are small and frequent;
// the exponential keeps each step proportional so the gesture feels even
// across the whole range instead of accelerating near the top. Tuned for a
// snappy pinch (a 120-delta notch ≈ +62%; was 0.0015 ≈ +20%, 0.0025 ≈ +35%).
const WHEEL_FACTOR = 0.004;

// Keyboard +/- step ratio (zoom in / zoom out).
const STEP_IN = 1.25;
const STEP_OUT = 0.8;

/**
 * "Contain" fit: the largest w×h with aspect `ratio` (= height/width) that
 * fits inside areaW×areaH. Mirrors the CSS `max-width/height:100%` +
 * `width/height:auto` resolution so the JS-driven zoom (≥1) starts exactly
 * where the CSS fit (=1) leaves off — no jump at the 1.0 boundary.
 *
 * @param {number} areaW  available content width (px)
 * @param {number} areaH  available content height (px)
 * @param {number} ratio  slide height / slide width (e.g. 720/1280)
 * @returns {{w:number,h:number}} fitted slide size, never below 1px
 */
function containFit(areaW, areaH, ratio) {
  if (!(areaW > 0) || !(areaH > 0) || !(ratio > 0)) {
    return { w: 1, h: 1 };
  }
  let w = areaW;
  let h = areaW * ratio;
  if (h > areaH) {
    h = areaH;
    w = areaH / ratio;
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Clamp a zoom level to [ZOOM_MIN, ZOOM_MAX]. */
function clampZoom(z) {
  if (!Number.isFinite(z)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * Next zoom level for a wheel/pinch delta. Negative deltaY (pinch open /
 * scroll up) zooms in. Result is already clamped.
 */
function zoomForWheel(current, deltaY) {
  return clampZoom(current * Math.exp(-deltaY * WHEEL_FACTOR));
}

/** Next zoom level for a keyboard step. dir > 0 zooms in, else out. */
function zoomForStep(current, dir) {
  return clampZoom(current * (dir > 0 ? STEP_IN : STEP_OUT));
}

/** True when a zoom level is effectively the fit (no pixel sizing needed). */
function isFit(z) {
  return z <= ZOOM_MIN + 0.001;
}

export {
  ZOOM_MIN,
  ZOOM_MAX,
  containFit,
  clampZoom,
  zoomForWheel,
  zoomForStep,
  isFit,
};

if (typeof globalThis !== 'undefined') {
  globalThis.MDVMarpZoom = {
    ZOOM_MIN,
    ZOOM_MAX,
    containFit,
    clampZoom,
    zoomForWheel,
    zoomForStep,
    isFit,
  };
}
