/**
 * MDV - Marp cluster shared state
 * Stage 3d. The ONE sanctioned non-verbatim change in this stage: the
 * original app.js held two bare module-level `let`s (marpCurrentSlide,
 * marpKeyHandler) shared by reference across ContentRenderer and
 * PresenterView inside the same IIFE. Splitting the cluster into separate
 * ES modules means a bare `let` in one file can no longer be read/written
 * from another, so this tiny module holds them behind get/set accessors
 * that every cluster module imports instead.
 */
let marpCurrentSlide = 0;
let marpKeyHandler = null;

export function getCurrentSlide() { return marpCurrentSlide; }
export function setCurrentSlide(index) { marpCurrentSlide = index; }
export function getKeyHandler() { return marpKeyHandler; }
export function setKeyHandler(handler) { marpKeyHandler = handler; }
