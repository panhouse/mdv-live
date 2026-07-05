/**
 * MDV - Marp Slide Zoom (trackpad pinch-to-zoom + pan) — DOM glue
 * Pure move from app.js (Stage 3d), with one directed exception: lib()
 * now imports the pure zoom math from lib/marpZoom.js as a real ES module
 * namespace instead of reading globalThis.MDVMarpZoom (see the comment on
 * lib() below). Self-contained otherwise: no cross-references to the
 * other Marp cluster modules.
 *
 * At fit (zoom === 1) the slide is sized entirely by the CSS "contain"
 * rules so the whole slide — image and all — is always visible. Zooming
 * past 1 switches the active SVG to explicit pixel dimensions
 * (fitSize * zoom); the pane's native overflow then lets a two-finger
 * scroll pan around the enlarged slide. macOS trackpad pinch arrives as a
 * `wheel` event with `ctrlKey` set, so ctrl+scroll on a mouse zooms too.
 */
import * as MarpZoomLib from '../lib/marpZoom.js';

export const MarpZoom = {
        area: null,
        zoom: 1,
        onWheel: null,
        onDblClick: null,
        ro: null,

        // Pure zoom math lives in lib/marpZoom.js so it can be unit-tested
        // without a DOM. Stage 3d: imported directly as an ES module
        // namespace instead of read off globalThis.MDVMarpZoom — a static
        // import always resolves before this file's own code runs, so the
        // `if (!this.lib())` guards below no longer trip; left in place as
        // defensive dead code rather than restructuring init()/nudge().
        lib() { return MarpZoomLib; },

        init(area) {
            this.detach();
            if (!this.lib()) return;
            this.area = area;
            this.zoom = 1;
            this.onWheel = (e) => {
                // Plain two-finger scroll is left to the pane so it pans the
                // zoomed slide natively. Only a pinch (ctrlKey) zooms.
                if (!e.ctrlKey) return;
                e.preventDefault();
                this.zoomTo(this.lib().zoomForWheel(this.zoom, e.deltaY), e.clientX, e.clientY);
            };
            // Double-click anywhere on the slide snaps back to fit.
            this.onDblClick = () => this.reset();
            area.addEventListener('wheel', this.onWheel, { passive: false });
            area.addEventListener('dblclick', this.onDblClick);
            // Re-apply the pixel size when the pane is resized (window resize,
            // dragging the notes splitter) so a zoomed slide tracks the new
            // fit instead of freezing at a stale size.
            if (typeof ResizeObserver !== 'undefined') {
                this.ro = new ResizeObserver(() => {
                    if (!this.lib().isFit(this.zoom)) this.zoomTo(this.zoom);
                });
                this.ro.observe(area);
            }
        },

        detach() {
            if (this.area && this.onWheel) {
                this.area.removeEventListener('wheel', this.onWheel);
                this.area.removeEventListener('dblclick', this.onDblClick);
            }
            if (this.ro) { this.ro.disconnect(); this.ro = null; }
            this.area = null;
            this.onWheel = null;
            this.onDblClick = null;
            this.zoom = 1;
        },

        activeSvg() {
            return this.area
                ? this.area.querySelector('.marpit > svg[data-marpit-svg].active')
                : null;
        },

        // Slide dimensions at fit (zoom 1), resolved the same way the CSS
        // "contain" rule does — so the 1.0 → 1.01 transition doesn't jump.
        fitSize(svg) {
            const cs = getComputedStyle(this.area);
            const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
            const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
            const aw = this.area.clientWidth - padX;
            const ah = this.area.clientHeight - padY;
            const vb = svg.viewBox && svg.viewBox.baseVal;
            const ratio = (vb && vb.width) ? vb.height / vb.width : 9 / 16;
            return this.lib().containFit(aw, ah, ratio);
        },

        // Apply `z` around a focal point (defaults to the pane centre). The
        // before/after rects already fold in centring and scroll offsets, so
        // the point under the cursor stays put as the slide grows.
        zoomTo(z, focalX, focalY) {
            const svg = this.activeSvg();
            if (!svg) return;
            z = this.lib().clampZoom(z);
            if (this.lib().isFit(z)) { this.reset(); return; }

            if (focalX == null) {
                const r = this.area.getBoundingClientRect();
                focalX = r.left + r.width / 2;
                focalY = r.top + r.height / 2;
            }
            const before = svg.getBoundingClientRect();
            const relX = before.width ? (focalX - before.left) / before.width : 0.5;
            const relY = before.height ? (focalY - before.top) / before.height : 0.5;

            this.zoom = z;
            const fit = this.fitSize(svg);
            svg.style.width = (fit.w * z) + 'px';
            svg.style.height = (fit.h * z) + 'px';
            this.area.classList.add('marp-zoomed');

            const after = svg.getBoundingClientRect();
            this.area.scrollLeft += (after.left + relX * after.width) - focalX;
            this.area.scrollTop += (after.top + relY * after.height) - focalY;
        },

        // Step zoom for keyboard (+/-): dir > 0 zooms in, else out.
        nudge(dir) {
            if (!this.lib()) return;
            this.zoomTo(this.lib().zoomForStep(this.zoom, dir));
        },

        // Back to fit: clear the pixel sizing on every slide (the active one
        // may have changed since we zoomed) and hand sizing back to CSS.
        reset() {
            this.zoom = 1;
            if (!this.area) return;
            this.area.querySelectorAll('.marpit > svg[data-marpit-svg]').forEach(s => {
                s.style.width = '';
                s.style.height = '';
            });
            this.area.classList.remove('marp-zoomed');
            this.area.scrollLeft = 0;
            this.area.scrollTop = 0;
        }
};
