/**
 * MDV - Presenter View (separate window with speaker notes)
 * Pure move from app.js (Stage 3d), plus the mechanical marpState rewiring
 * described in modules/marpState.js: the bare `marpCurrentSlide` reads/
 * writes here become getCurrentSlide()/setCurrentSlide() calls.
 *
 * Depends on MarpZoom (gotoSlide's reset-to-fit) from marpZoomGlue.js.
 * Does NOT depend on InlineNotesPanel or ContentRenderer — no cycle on
 * this side (see contentRenderer.js / inlineNotes.js for the cycle that
 * does exist between those two).
 *
 * Stage 3f (SSOT polish, values unchanged): the 'STALE'/'NO_DECK' code
 * literals now come from lib/errorCodes.js ERROR_CODES, and the
 * BroadcastChannel `type` literals ('request-slides', 'goto',
 * 'find-saver', 'edit-note', 'saver-here', 'note-saved', 'slides',
 * 'index') now come from lib/presenterChannel.js TYPES — mirrored in
 * presenter.html's inline module script.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { getCurrentSlide, setCurrentSlide } from './marpState.js';
import { MarpZoom } from './marpZoomGlue.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { TYPES } from '../lib/presenterChannel.js';

export const PresenterView = {
        channel: null,
        // Unique id for this main window. The presenter echoes it back as
        // `edit-note.targetWindowId` so that exactly one main window saves,
        // even when the same deck is open in several windows.
        windowId: null,
        presenterWindow: null,
        saveQueue: null,            // MDVSaveQueue instance (created in init)
        // Map<path, etag> — own-save chain rebase. We track presenter and
        // inline saves separately so that a successful save from one editor
        // doesn't let the other editor rebase past a stale pinned etag and
        // silently overwrite the other editor's in-flight changes.
        lastSavedEtag: new Map(),
        lastSavedInlineEtag: new Map(),

        init() {
            if (!window.MDVSaveQueue) return;

            // saveQueue rebases queued edits onto the etag of our last own
            // save when there has been no external watcher update. If an
            // external edit arrives, fallback to the originally-pinned etag
            // so optimistic locking can detect the conflict via 412.
            //
            // IMPORTANT: the rebase only applies to Presenter-originated
            // saves. Inline-panel saves (origin === 'inline') always use
            // the etag pinned at edit start so a concurrent presenter edit
            // gets the STALE conflict it deserves. Without this guard a
            // successful inline save would mark its post-save etag as
            // "own" for the shared queue, and the presenter's next save
            // would silently overwrite the inline edit.
            //
            // The 5th arg (`origin`) is forwarded to saveNote so the
            // note-saved broadcast can be filtered correctly on the
            // presenter side.
            //
            // The queue is created unconditionally — independent of
            // BroadcastChannel availability — so the inline notes panel
            // can autosave in environments (older browsers / sandboxed
            // webviews) where the Presenter window cannot be opened.
            this.saveQueue = window.MDVSaveQueue.createSaveQueue({
                saveFn: (path, slideIndex, note, etag, origin, requestId) => {
                    let useEtag = etag;
                    const tab = state.tabs.find((t) => t.path === path);
                    // Pick the "own etag" map that matches this save's
                    // origin, so a presenter save can't rebase past an
                    // inline edit (and vice versa). The same-origin check
                    // — `tab.etag === own` — is what tells us no other
                    // editor wrote in between, making the rebase safe.
                    const ownMap = origin === 'inline'
                        ? this.lastSavedInlineEtag
                        : this.lastSavedEtag;
                    const own = ownMap.get(path);
                    if (tab && own && tab.etag === own) useEtag = own;
                    return this.saveNote(path, slideIndex, note, useEtag, origin, requestId);
                }
            });

            // When a tab closes, drop its queued saves and own-etag entry to
            // prevent a slow leak under long sessions with many decks.
            if (window.MDVTabRegistry) {
                window.MDVTabRegistry.onTabClosed((path) => {
                    if (this.saveQueue) this.saveQueue.dropPath(path);
                    this.lastSavedEtag.delete(path);
                    this.lastSavedInlineEtag.delete(path);
                });
            }

            // BroadcastChannel powers the cross-window presenter view.
            // Where it's missing we keep the inline path working with
            // saveQueue alone — broadcastSlides / saveNote then no-op
            // their channel.postMessage calls (channel === null).
            if (typeof BroadcastChannel !== 'undefined'
                && window.MDVPresenterChannel) {
                this.windowId = window.MDVPresenterChannel.newWindowId();
                this.channel = window.MDVPresenterChannel.create();
                if (this.channel) {
                    this.channel.addEventListener('message', (e) => {
                        const msg = e.data || {};
                        if (msg.type === TYPES.REQUEST_SLIDES) {
                            this.broadcastSlides();
                        } else if (msg.type === TYPES.GOTO) {
                            this.gotoSlide(msg.index);
                        } else if (msg.type === TYPES.FIND_SAVER) {
                            // Failover discovery: the presenter lost its
                            // saver and asks who can save `path`. Answer if
                            // this window holds that deck in ANY tab —
                            // saveNote() resolves by path, so an inactive
                            // background tab counts (broadcastSlides only
                            // reports the active tab and would miss it).
                            if (msg.path
                                && state.tabs.some((t) => t.path === msg.path && t.isMarp)) {
                                this.channel.postMessage({
                                    type: TYPES.SAVER_HERE,
                                    path: msg.path,
                                    windowId: this.windowId
                                });
                            }
                        } else if (msg.type === TYPES.EDIT_NOTE) {
                            if (!msg.path) return;
                            // Route: only the main window the presenter
                            // picked as its saver performs the save. Without
                            // this, every main window showing the same deck
                            // fires its own PUT and all but one collide on
                            // the optimistic lock → spurious "STALE" in the
                            // presenter. A missing targetWindowId (older
                            // presenter build) falls back to handling it so
                            // saves still work, just without dedup.
                            if (msg.targetWindowId
                                && msg.targetWindowId !== this.windowId) {
                                return;
                            }
                            this.saveQueue.enqueue(
                                msg.path, msg.slideIndex, msg.note,
                                msg.etag || null, 'presenter', msg.requestId
                            );
                        }
                    });
                }
            }

            window.addEventListener('beforeunload', () => {
                if (this.presenterWindow && !this.presenterWindow.closed) {
                    this.presenterWindow.close();
                }
            });
        },

        // Persist a speaker note edit via the Marpit-token-based API. The
        // server resolves the path, validates ETag, and rewrites surgically.
        // `editTimeEtag` is the etag captured at edit start; we send that as
        // If-Match (NOT the live tab.etag) so a watcher refresh during the
        // debounce can't smuggle a write past the lock.
        //
        // `origin` is forwarded into the note-saved broadcast so the
        // Presenter window can refuse to advance its editingEtag onto a
        // save that came from the inline panel (otherwise the Presenter's
        // next autosave would skip the STALE conflict it should otherwise
        // hit and silently overwrite the inline edit).
        //
        // `requestId` is the opaque token from the presenter's edit-note;
        // echoing it back in note-saved lets the presenter match this
        // result to the exact save it sent (older saves' acks then can't
        // cancel a newer save's failover timer).
        //
        // Returns { ok, etag?, normalizedNote?, reason?, code? } so saveQueue
        // can forward the result to enqueue() awaiters (the main-window inline
        // notes panel reads this). The presenter window still gets results via
        // the existing channel.postMessage('note-saved') broadcast.
        async saveNote(path, slideIndex, note, editTimeEtag, origin, requestId) {
            const broadcast = (payload) => {
                // No-op when BroadcastChannel was unavailable at init —
                // inline autosaves still work because callers also read
                // the saveFn return value via saveQueue.enqueue().then().
                if (!this.channel) return;
                this.channel.postMessage({
                    type: TYPES.NOTE_SAVED,
                    path,
                    slideIndex,
                    origin: origin || 'unknown',
                    sourceWindowId: this.windowId,
                    requestId,
                    ...payload
                });
            };

            const tab = state.tabs.find((t) => t.path === path);
            if (!tab || !tab.isMarp) {
                // This window no longer holds the deck (tab closed / switched
                // away). Broadcast a NO_DECK failure so a presenter that
                // routed here can fail over to another window instead of
                // hanging on "保存中…" or surfacing a dead-end error.
                const result = {
                    ok: false,
                    code: ERROR_CODES.NO_DECK,
                    reason: 'No active Marp tab'
                };
                broadcast(result);
                return result;
            }
            const ifMatch = editTimeEtag || tab.etag;
            if (!ifMatch) {
                // GET degrade or no etag yet — refuse without writing.
                const result = {
                    ok: false,
                    reason: 'Deck not parseable (degraded mode)'
                };
                broadcast(result);
                return result;
            }

            let res, data;
            try {
                ({ res, data } = await window.MDVApi.saveMarpNote(path, slideIndex, note, ifMatch));
            } catch (err) {
                console.error('saveNote network error', err);
                const result = { ok: false, reason: 'Network error' };
                broadcast(result);
                return result;
            }

            if (res.status === 412 && data.code === ERROR_CODES.STALE) {
                // The file changed under us. Do NOT update tab.etag here —
                // tab.content/notes/slideRanges are still the pre-conflict
                // version, so adopting the new etag would let the next edit
                // pass If-Match while the deck index is wrong. The watcher's
                // file_update event will refresh tab.{content,notes,etag}
                // together once chokidar sees the change. Until then, all
                // PUTs from this tab keep returning 412.
                const result = {
                    ok: false,
                    code: ERROR_CODES.STALE,
                    reason: 'STALE — file changed externally; please reload'
                };
                broadcast(result);
                return result;
            }

            if (res.ok && data.ok) {
                // Update local tab state from the server's authoritative
                // post-rewrite payload so re-broadcasts and the editor
                // immediately see the saved content. Otherwise raw/notes
                // would lag until the watcher's file_update event arrives.
                tab.etag = data.etag;
                // Track post-save etag separately per origin. The shared
                // queue uses this map to rebase queued same-origin
                // autosaves onto our own post-save etag (so a user typing
                // continuously gets through), but recording into the OTHER
                // origin's map would let it skip STALE and overwrite an
                // in-flight edit from the concurrent editor.
                if (origin === 'inline') {
                    this.lastSavedInlineEtag.set(path, data.etag);
                } else {
                    this.lastSavedEtag.set(path, data.etag);
                }
                if (typeof data.source === 'string') tab.raw = data.source;
                if (Array.isArray(data.notes)) tab.notes = data.notes;
                if (Array.isArray(data.notesMultiplicity)) {
                    tab.notesMultiplicity = data.notesMultiplicity;
                }
                const result = {
                    ok: true,
                    etag: data.etag,
                    normalizedNote: data.normalizedNote
                };
                broadcast(result);
                // Re-broadcast so the presenter window picks up the new
                // notes/etag without waiting for the watcher event.
                this.broadcastSlides();
                return result;
            }

            const reason = data && (data.error || data.code) || 'Save failed';
            const result = { ok: false, reason };
            broadcast(result);
            return result;
        },

        open() {
            const tab = state.tabs[state.activeTabIndex];
            if (!tab || !tab.isMarp) return;

            if (this.presenterWindow && !this.presenterWindow.closed) {
                this.presenterWindow.focus();
                this.broadcastSlides();
                return;
            }

            this.presenterWindow = window.open(
                '/static/presenter.html',
                'mdv-presenter',
                'width=1280,height=720,resizable=yes,scrollbars=yes'
            );

            // presenter sends `request-slides` on load, but broadcast as a fallback
            setTimeout(() => this.broadcastSlides(), 300);
        },

        broadcastSlides() {
            if (!this.channel) return;
            const tab = state.tabs[state.activeTabIndex];
            if (!tab || !tab.isMarp) {
                // Active tab is not a Marp deck (or no tab) — clear the
                // presenter so it doesn't keep showing stale slides /
                // accept edits against the wrong file.
                this.channel.postMessage({
                    type: TYPES.SLIDES,
                    empty: true,
                    reason: 'main-switched-away',
                    sourceWindowId: this.windowId
                });
                return;
            }
            this.channel.postMessage({
                type: TYPES.SLIDES,
                path: tab.path,
                html: tab.content,
                css: tab.css,
                notes: tab.notes || [],
                notesMultiplicity: tab.notesMultiplicity || [],
                etag: tab.etag || null,
                current: getCurrentSlide(),
                sourceWindowId: this.windowId
            });
        },

        broadcastIndex(index) {
            if (!this.channel) return;
            this.channel.postMessage({ type: TYPES.INDEX, index });
        },

        gotoSlide(index) {
            const slides = elements.content.querySelectorAll('.marpit > svg[data-marpit-svg]');
            if (!slides.length || index < 0 || index >= slides.length) return;
            // Each slide opens at fit; clear any zoom carried from the last one.
            MarpZoom.reset();
            slides.forEach((s, i) => s.classList.toggle('active', i === index));
            const panels = elements.content.querySelectorAll(
                '#marpNotesArea > .speaker-notes-panel'
            );
            panels.forEach((p, i) => p.classList.toggle('active', i === index));
            setCurrentSlide(index);
            const counter = elements.content.querySelector('.slide-counter');
            if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
            const prevBtn = elements.content.querySelector('.marp-prev');
            const nextBtn = elements.content.querySelector('.marp-next');
            if (prevBtn) prevBtn.disabled = index === 0;
            if (nextBtn) nextBtn.disabled = index === slides.length - 1;
        }
};
