/**
 * MDV - Content Renderer
 * Pure move from app.js (Stage 3d), plus the mechanical marpState rewiring
 * described in modules/marpState.js: the bare marpCurrentSlide/
 * marpKeyHandler reads/writes here become getCurrentSlide()/
 * setCurrentSlide()/getKeyHandler()/setKeyHandler() calls (marpKeyHandler
 * itself is kept as a local `keyHandler` const inside each function that
 * used to close over the module-level `let`).
 *
 * Forward references: this file imports InlineNotesPanel from
 * inlineNotes.js, which in turn imports ContentRenderer back from this
 * file (InlineNotesPanel.handleFocusOut calls ContentRenderer.renderMarp
 * inside a queueMicrotask callback — never at module-eval time). Native
 * ESM resolves this cycle via live bindings: both modules finish
 * evaluating before DOMContentLoaded fires and any callback can run, so
 * the binding is already initialized by the time it's actually read. No
 * import-cycle issue observed in the E2E gates (07 marp-preview, 08
 * inline-notes autosave).
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { escapeHtml, getFileIcon } from './utils.js';
import { getCurrentSlide, setCurrentSlide, getKeyHandler, setKeyHandler } from './marpState.js';
import { InlineNotesPanel } from './inlineNotes.js';
import { MarpSplitHandle } from './marpSplit.js';
import { MarpZoom } from './marpZoomGlue.js';
import { PresenterView } from './presenterView.js';

export const ContentRenderer = {
        render(htmlContent, fileType) {
            const containerClass = fileType === 'code'
                ? 'markdown-body code-view-container'
                : fileType === 'markdown'
                    ? 'markdown-body pdf-style-preview'
                    : 'markdown-body';
            elements.content.innerHTML = `<div class="${containerClass}">${htmlContent}</div>`;

            elements.content.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            if (fileType === 'markdown') {
                this.renderMermaid();
            }
        },

        renderMarp(htmlContent, css) {
            // Clean up previous Marp handlers
            this.cleanupMarp();

            elements.content.classList.add('marp-viewer');

            // Apply Marp CSS from marp-core (preserves exact structure for CSS selectors)
            if (css) {
                // Remove previous Marp style
                const oldStyle = document.getElementById('marp-style');
                if (oldStyle) oldStyle.remove();

                // Add new Marp style with navigation overrides
                const style = document.createElement('style');
                style.id = 'marp-style';
                // marp-core's per-deck CSS is injected unmodified; the split
                // layout / responsive sizing rules live in styles.css so they
                // load once and don't need to be repeated per render.
                style.textContent = css;
                document.head.appendChild(style);
            }

            // PowerPoint-style split: top = slide stage, bottom = notes
            // editor, with a draggable horizontal handle between them. The
            // marp-core HTML (`<div class="marpit">…</div>`) lives inside
            // .marp-slide-area; speaker-notes panels stack inside
            // .marp-notes-area and the active one is shown via JS.
            elements.content.innerHTML = `
                <div class="marp-split" id="marpSplit">
                    <div class="marp-slide-area" id="marpSlideArea">${htmlContent}</div>
                    <div class="marp-split-handle" id="marpSplitHandle" title="ドラッグでスライド/ノートの比率を変更（ダブルクリックでリセット）"></div>
                    <div class="marp-notes-area" id="marpNotesArea"></div>
                </div>
            `;

            const marpit = elements.content.querySelector('.marpit');
            const notesArea = document.getElementById('marpNotesArea');
            if (marpit && notesArea) {
                const tab = state.tabs[state.activeTabIndex];
                const notes = (tab && Array.isArray(tab.notes)) ? tab.notes : [];
                const multiplicity = (tab && Array.isArray(tab.notesMultiplicity))
                    ? tab.notesMultiplicity : [];
                const hasEtag = !!(tab && tab.etag);
                const svgs = marpit.querySelectorAll('svg[data-marpit-svg]');
                svgs.forEach((_svg, i) => {
                    const panel = InlineNotesPanel.buildPanel(
                        i,
                        notes[i] || '',
                        multiplicity[i] || 0,
                        hasEtag
                    );
                    notesArea.appendChild(panel);
                });
                InlineNotesPanel.attach();
            }

            // Wire up the split-pane drag handle.
            const splitEl = document.getElementById('marpSplit');
            const handleEl = document.getElementById('marpSplitHandle');
            if (splitEl && handleEl) {
                MarpSplitHandle.attach(splitEl, handleEl);
            }

            // Enable trackpad pinch-to-zoom / pan on the slide pane.
            const slideArea = document.getElementById('marpSlideArea');
            if (slideArea) {
                MarpZoom.init(slideArea);
            }

            // Add navigation controls. The nav is appended to .content (NOT
            // marpit) so its `position: fixed` doesn't get clipped by the
            // grid container's overflow:hidden rule.
            if (marpit) {
                const nav = document.createElement('div');
                nav.className = 'marp-nav';
                nav.innerHTML = `
                    <button class="marp-prev" title="Previous (←)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <span class="slide-counter">1 / 1</span>
                    <button class="marp-next" title="Next (→)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <button class="marp-fullscreen-btn" title="Fullscreen (F)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                    </button>
                    <button class="marp-presenter-btn" title="Presenter View (P)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                    </button>
                    <button class="marp-close-nav" title="Hide (N to show)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                `;
                // Append to .content directly (NOT marpit) so it sits
                // outside .marp-split — fixed positioning + overflow:hidden
                // on the grid container would otherwise interact poorly.
                elements.content.appendChild(nav);
            }

            // Initialize slide navigation
            this.initMarpNavigation();

            // Syntax highlight
            elements.content.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            // Mermaid
            this.renderMermaid();
        },

        initMarpNavigation() {
            // Marp uses svg[data-marpit-svg] for each slide
            const slides = elements.content.querySelectorAll('.marpit > svg[data-marpit-svg]');
            const counter = elements.content.querySelector('.slide-counter');
            const prevBtn = elements.content.querySelector('.marp-prev');
            const nextBtn = elements.content.querySelector('.marp-next');

            if (slides.length === 0) return;

            // Reset to first slide (or restore position if within bounds)
            if (getCurrentSlide() >= slides.length) {
                setCurrentSlide(0);
            }

            // Cache the panels alongside the slides so flipping the active
            // class is one DOM read instead of a fresh query per click.
            const panels = elements.content.querySelectorAll(
                '#marpNotesArea > .speaker-notes-panel'
            );

            const showSlide = (index) => {
                // Each slide opens at fit; clear any zoom from the last one.
                MarpZoom.reset();
                slides.forEach((slide, i) => {
                    slide.classList.toggle('active', i === index);
                });
                panels.forEach((panel, i) => {
                    panel.classList.toggle('active', i === index);
                });
                setCurrentSlide(index);
                if (counter) {
                    counter.textContent = `${index + 1} / ${slides.length}`;
                }
                if (prevBtn) prevBtn.disabled = index === 0;
                if (nextBtn) nextBtn.disabled = index === slides.length - 1;
                PresenterView.broadcastIndex(index);
            };

            const nextSlide = () => {
                if (getCurrentSlide() < slides.length - 1) {
                    showSlide(getCurrentSlide() + 1);
                }
            };

            const prevSlide = () => {
                if (getCurrentSlide() > 0) {
                    showSlide(getCurrentSlide() - 1);
                }
            };

            // Show initial slide
            showSlide(getCurrentSlide());

            // Button handlers
            if (prevBtn) prevBtn.addEventListener('click', prevSlide);
            if (nextBtn) nextBtn.addEventListener('click', nextSlide);

            // Fullscreen toggle
            const fullscreenBtn = elements.content.querySelector('.marp-fullscreen-btn');
            const expandIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>';
            const shrinkIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4m0 5H4m5 0L4 4m11 5h5m-5 0V4m0 5l5-5M9 15v5m0-5H4m5 0l-5 5m11-5h5m-5 0v5m0-5l5 5" /></svg>';
            const toggleFullscreen = () => {
                // Snap back to fit across the transition: the fullscreen and
                // windowed panes have different sizes, and the fullscreen CSS
                // owns the fit there, so a leftover pixel zoom would mis-size
                // the slide. The user can re-pinch on either side.
                MarpZoom.reset();
                document.body.classList.toggle('marp-fullscreen');
                const isFullscreen = document.body.classList.contains('marp-fullscreen');
                if (fullscreenBtn) {
                    fullscreenBtn.innerHTML = isFullscreen ? shrinkIcon : expandIcon;
                    fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen (F)';
                }
                // Reset nav position when exiting fullscreen
                const nav = elements.content.querySelector('.marp-nav');
                if (!isFullscreen && nav) {
                    nav.style.left = '';
                    nav.style.top = '';
                    nav.style.right = '';
                    nav.style.bottom = '';
                    nav.style.transform = '';
                }
            };
            if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

            // Presenter view button
            const presenterBtn = elements.content.querySelector('.marp-presenter-btn');
            if (presenterBtn) presenterBtn.addEventListener('click', () => PresenterView.open());

            // Make nav draggable and closeable
            const nav = elements.content.querySelector('.marp-nav');
            if (nav) {
                let isDragging = false;
                let dragStartX, dragStartY, navStartX, navStartY;

                nav.addEventListener('mousedown', (e) => {
                    // Don't drag when clicking buttons or not in fullscreen
                    if (e.target.closest('button')) return;
                    if (!document.body.classList.contains('marp-fullscreen')) return;
                    isDragging = true;
                    nav.classList.add('dragging');
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    const rect = nav.getBoundingClientRect();
                    navStartX = rect.left;
                    navStartY = rect.top;
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    const dx = e.clientX - dragStartX;
                    const dy = e.clientY - dragStartY;
                    const newX = Math.max(0, Math.min(window.innerWidth - nav.offsetWidth, navStartX + dx));
                    const newY = Math.max(0, Math.min(window.innerHeight - nav.offsetHeight, navStartY + dy));
                    nav.style.left = newX + 'px';
                    nav.style.top = newY + 'px';
                    nav.style.right = 'auto';
                    nav.style.bottom = 'auto';
                    nav.style.transform = 'none';
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        nav.classList.remove('dragging');
                    }
                });

                // Close button to hide nav
                const closeBtn = nav.querySelector('.marp-close-nav');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        nav.classList.add('hidden');
                    });
                }
            }

            // Keyboard navigation
            const keyHandler = (e) => {
                // Don't handle if editing or in dialog
                if (state.isEditMode || !elements.dialogOverlay.classList.contains('hidden')) {
                    return;
                }
                const nav = elements.content.querySelector('.marp-nav');
                if (e.key === 'ArrowRight' || e.key === ' ') {
                    e.preventDefault();
                    nextSlide();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    prevSlide();
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    toggleFullscreen();
                } else if (e.key === 'n' || e.key === 'N') {
                    e.preventDefault();
                    if (nav) nav.classList.toggle('hidden');
                } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    // Skip if modifiers are held — Cmd/Ctrl+P is the print
                    // shortcut and must not also open the presenter view.
                    e.preventDefault();
                    PresenterView.open();
                } else if ((e.key === '+' || e.key === '=') && !e.metaKey && !e.ctrlKey) {
                    // Keyboard zoom (centre-anchored) mirrors the pinch gesture.
                    // Skip Cmd/Ctrl which the browser owns for page zoom.
                    e.preventDefault();
                    MarpZoom.nudge(1);
                } else if ((e.key === '-' || e.key === '_') && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    MarpZoom.nudge(-1);
                } else if (e.key === '0' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    MarpZoom.reset();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (document.body.classList.contains('marp-fullscreen')) {
                        toggleFullscreen();
                    } else if (nav && nav.classList.contains('hidden')) {
                        nav.classList.remove('hidden');
                    }
                }
            };
            setKeyHandler(keyHandler);
            document.addEventListener('keydown', keyHandler);
        },

        cleanupMarp() {
            // Flush + detach BEFORE the DOM is wiped so a pending
            // 800ms save timer doesn't fire after the editor element is gone.
            InlineNotesPanel.detach();
            MarpSplitHandle.detach();
            MarpZoom.detach();
            elements.content.classList.remove('marp-viewer');
            document.body.classList.remove('marp-fullscreen');
            const keyHandler = getKeyHandler();
            if (keyHandler) {
                document.removeEventListener('keydown', keyHandler);
                setKeyHandler(null);
            }
        },

        async renderMermaid() {
            const blocks = elements.content.querySelectorAll('code.language-mermaid');
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                const pre = block.parentElement;
                const mermaidCode = block.textContent;
                const div = document.createElement('div');
                div.className = 'mermaid';

                try {
                    const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, mermaidCode);
                    div.innerHTML = svg;
                    pre.replaceWith(div);
                } catch (e) {
                    console.error('Mermaid error:', e);
                }
            }
        },

        renderImage(imageUrl, name) {
            const url = imageUrl + '&t=' + Date.now();
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="image-preview">
                    <img src="${url}" alt="${safeName}" />
                    <div class="image-info">${safeName}</div>
                </div>
            `;
        },

        renderPDF(pdfUrl, name) {
            const url = pdfUrl + '&t=' + Date.now();
            const safeName = escapeHtml(name);
            elements.content.style.padding = '0';
            elements.content.innerHTML = `
                <div class="pdf-viewer">
                    <iframe src="${url}" title="${safeName}"></iframe>
                </div>
            `;
        },

        renderHTML(htmlUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.style.padding = '0';
            elements.content.innerHTML = `
                <div class="html-preview">
                    <iframe src="${htmlUrl}" title="${safeName}"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals">
                    </iframe>
                </div>
            `;
        },

        renderVideo(mediaUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="video-preview">
                    <video controls>
                        <source src="${mediaUrl}" type="video/mp4">
                        お使いのブラウザは動画再生に対応していません。
                    </video>
                    <div class="media-info">${safeName}</div>
                </div>
            `;
        },

        renderAudio(mediaUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="audio-preview">
                    <audio controls>
                        <source src="${mediaUrl}">
                        お使いのブラウザは音声再生に対応していません。
                    </audio>
                    <div class="media-info">${safeName}</div>
                </div>
            `;
        },

        renderBinary(name, icon) {
            const safeName = escapeHtml(name);
            const iconSvg = getFileIcon(icon);
            elements.content.innerHTML = `
                <div class="binary-preview">
                    <div class="binary-icon">${iconSvg}</div>
                    <div class="binary-info">${safeName}</div>
                </div>
            `;
        },

        showWelcome() {
            elements.content.innerHTML = `
                <div class="welcome">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h2>Select a file</h2>
                    <p>Choose a file from the sidebar</p>
                    <p><kbd>Cmd+E</kbd> Edit &nbsp; <kbd>Cmd+S</kbd> Save &nbsp; <kbd>Cmd+P</kbd> PDF</p>
                </div>
            `;
        }
};
