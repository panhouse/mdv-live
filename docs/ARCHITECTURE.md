# Architecture

Deep module map for `mdv-live`. Start with `CLAUDE.md` for the concise
version and the conventions every change must follow; this document is the
detailed reference: module inventory, request/data flow, SSOT table, and
"how to extend" checklists.

For refactor history/rationale (why things are split the way they are), see
`docs/refactoring-2026-07-strategy.md`.

## 1. Module inventory

### CLI (`src/cli/`, entry `bin/mdv.js`)

| Module | Role |
|---|---|
| `bin/mdv.js` | Thin entry point. Parses `process.argv`, calls `dispatch()`, and is the **only** place that calls `process.exit()`. |
| `src/cli/registry.js` | Subcommand table (`commands`) + `dispatch()`/`resolveCommand()`/`parseCommandArgs()`. Adding a subcommand = adding a table entry; `main()` never changes (OCP). Also owns the default viewer command (`runViewer`) and port-finding (`findAvailablePort`). |
| `src/cli/config.js` | Loads and validates `mdv.config.json` from a given directory. |
| `src/cli/convert.js` | `mdv convert` subcommand: routes Marp files to `exportMarpPdf`, plain markdown to `exportMarkdownPdf` (both from `src/services/pdf.js`). |
| `src/cli/resolveTarget.js` | Resolves the viewer's positional path argument to `{ rootDir, initialFile }`. |
| `src/cli/serverRegistry.js` | `mdv -l` (list) / `mdv -k` (kill) — shells out to `lsof`/`ps`/`kill`. Unix-only. |
| `src/cli/errors.js` | `UsageError` — every CLI helper throws this instead of exiting, so `src/cli/` is unit-testable without spawning a subprocess. |

### Backend core

| Module | Role |
|---|---|
| `src/server.js` | `createMdvServer(options)`: builds the Express app, wires all API route setup functions, the body-size error handler, the SPA catch-all, WebSocket server, and file watcher. Owns the `app.locals.allowedHosts` contract (see §3). |
| `src/watcher.js` | chokidar wrapper. On `change`, re-renders the file and broadcasts `file_update` to clients watching that path. On add/unlink (file or dir), debounces and broadcasts `tree_update`. Since 0.6.5, `change` and text-file `add` events also coalesce into a `files_changed` broadcast (all clients) — see §2.2. |
| `src/websocket.js` | `ws` server setup: per-client "watch" registry (`clientWatches`), `wss.broadcast()` (all clients), `wss.broadcastFileUpdate()` (only clients watching that path), and `broadcastTreeUpdate()` (the one place the `tree_update` payload is constructed). |

### API routes (`src/api/`)

| Module | Routes | Role |
|---|---|---|
| `src/api/file.js` | `GET /raw/*`, `GET/POST/DELETE /api/file`, `POST /api/mkdir`, `POST /api/move`, `GET /api/download` | File CRUD. Mutating routes are Origin-guarded and per-path locked; save goes through `atomicWrite`. Download supports HTTP Range for video/audio streaming. |
| `src/api/tree.js` | `GET /api/tree`, `GET /api/tree/expand`, `GET /api/tree/page` | File tree listing. Eagerly loads only one level deep (`MAX_INITIAL_DEPTH`); directories beyond `MAX_CHILDREN_PER_DIR` children are paginated via `/api/tree/page`. |
| `src/api/upload.js` | `POST /api/upload` | multer disk-storage upload. Destination directory is realpath-validated before multer touches disk; Origin-guarded. |
| `src/api/diff.js` | `GET /api/diff` | Change-tracking line diff. Reads the current file, records it into `app.locals.changeJournal`, and diffs it (`src/utils/lineDiff.js`) against a client-supplied baseline hash (`from`), if the journal still has that version's content. Read-only, no Origin guard. |
| `src/api/pdf.js` | `POST /api/pdf/export` | Delegates to `src/services/pdf.js`; Marp files → `marp-cli`, plain markdown → `md-to-pdf`. Writes to `os.tmpdir()`, streams the download, then deletes the temp file. |
| `src/api/marpNote.js` | `GET/OPTIONS /api/marp/decks/:path`, `PUT/OPTIONS .../slides/:N/note` | Orchestration only — wires `handleGet`/`handlePut` and the shared CORS-preflight/Origin check. |
| `src/api/marpNote/guards.js` | — | Content-Type / If-Match / slide-index-range / note-text validation. Re-exports `checkHost`/`checkOrigin`/`buildAllowedHosts` from `middleware/originGuard.js`. |
| `src/api/marpNote/readDeck.js` | — | `readDeckSafely()`: path-traversal + symlink-safe file read, returns `{ rawSource, stat, realPath }`. |
| `src/api/marpNote/handleGet.js` | — | Read-only deck snapshot: etag, slide count, notes, notes-multiplicity, line-ending/BOM info. |
| `src/api/marpNote/handlePut.js` | — | Speaker-note update: If-Match optimistic lock, per-realpath mutex, realpath-retarget trampoline (handles the deck's path resolving to a different file mid-request), re-parses and returns the fresh etag/notes in one round trip. |
| `src/api/middleware/originGuard.js` | — | SSOT Origin/Host (CSRF/DNS-rebinding) rule: `buildAllowedHosts`, `checkHost`, `checkOrigin`, `makeOriginGuard()` (Express middleware factory). |

### Rendering (`src/rendering/`)

| Module | Role |
|---|---|
| `src/rendering/index.js` | `renderFile()`: dispatches by file type (markdown/code/text), rewrites relative `<img>/<video>/<audio>/<source>` `src` and Marp `![bg]` `background-image: url(...)` to `/raw/...` URLs. |
| `src/rendering/markdown.js` | markdown-it instance: CJK emphasis flanking-rule fix, tables, strikethrough, task lists, YAML-frontmatter-as-code-block, Mermaid-block protection (so markdown-it doesn't mangle fenced ` ```mermaid ` blocks). Re-exports the canonical `isMarp` from `marpitAdapter.js`. |
| `src/rendering/marp.js` | Thin compatibility wrapper — delegates to `marpitAdapter.renderDeck`. Do not modify Marp's HTML output structure; the CSS depends on the exact `div.marpit > svg > foreignObject > section` shape. |
| `src/rendering/marpitAdapter.js` | **SSOT** for all Marp/Marpit parsing. Normalizes slide-range and speaker-note-position token output. Contract is snapshot-frozen by `tests/test-marpit-adapter.js` — do not call `marp.markdown.parse()`/`marp.render()` directly from anywhere else. |
| `src/rendering/marpNoteWriter.js` | Pure function: splices a speaker-note comment into raw markdown at the right line range (or appends one). At most one auto-saved note per slide (Multi-note Guard). |
| `src/rendering/office.js` | xlsx/pptx/docx "vibe preview" (雰囲気プレビュー, 0.6.0): unzips OOXML with `fflate`, extracts text via tolerant regex (not a full XML parser — namespace-prefix- and attribute-order-agnostic). Returns an escaped `<div class="office-preview">` fragment; throws a coded `OFFICE_PREVIEW_FAILED` error on any parse failure (corrupt zip, missing part, password-protected, oversized), which `src/api/file.js` catches and falls back to the plain binary response for. |

### Services, styles, concurrency, utils

| Module | Role |
|---|---|
| `src/services/pdf.js` | Actual PDF generation (spawns `marp-cli` / `md-to-pdf`). Shared by `src/api/pdf.js` (HTTP) and `src/cli/convert.js` (CLI) so both paths get the same bug fixes/security checks. Throws `PDF_TOOL_UNAVAILABLE` when an optional dependency is missing. |
| `src/services/changeJournal.js` | `createChangeJournal()`: pure in-memory store of recent raw-content snapshots per path, keyed by content hash (reuses `makeEtag`). One instance lives at `app.locals.changeJournal` (`src/server.js`); `src/watcher.js` records into it on every filesystem change, `src/api/diff.js` records into it (lazily) and reads from it on every request. Global byte-budget LRU eviction (`JOURNAL_MAX_BYTES`) + a per-file version cap (`JOURNAL_MAX_VERSIONS_PER_FILE`), both from `src/config/constants.js`. |
| `src/utils/lineDiff.js` | `diffLines(oldText, newText)`: dependency-free line-level diff (Myers O(ND)), pure function. Returns `{ added, changed, removedAt, removed }` (1-based NEW-text line numbers; `removed` is `{ afterLine, lines }[]`, the deleted OLD-text lines per pure-deletion hunk, added 0.6.10 for Word-style strikethrough display) or `{ available: false }` above `DIFF_MAX_LINES`. Backs `src/api/diff.js`. |
| `src/styles/index.js` | PDF style presets (`PRESETS`) + `resolveStyle()`/`resolvePdfOptions()` for the `-s`/`--pdf-options` CLI flags and the Web UI Style panel. |
| `src/concurrency/pathLock.js` | `withLock(key, fn)` — promise-chain mutex. FIFO per key; replaces a naive Map-based lock that had a thundering-herd race. |
| `src/utils/errors.js` | `ERROR_STATUS` map, `mkError()`, `sendError()`. The **only** way a route should produce an error response. |
| `src/utils/etag.js` | `makeEtag(rawSource)` → `sha256:<hex>`. |
| `src/utils/html.js` | `escapeHtml()` — 5-entity HTML escaping, SSOT (replaced 3 drifted implementations). |
| `src/utils/atomicWrite.js` | `atomicWrite()` (temp file + `O_EXCL` + rename, EXDEV fallback, permission-preserving) and `sweepStaleTemps()` (best-effort cleanup of crash-orphaned temp files on server start). |
| `src/utils/path.js` | `validatePath()`, `validatePathReal()` (symlink-aware), `getRelativePath()`, `resolveWithinRoot()` (the one-call helper route handlers should use). |
| `src/utils/ignorePatterns.js` | `IGNORED_NAMES`/`isIgnoredName()` (tree.js, single directory level) and `CHOKIDAR_IGNORED` (watcher.js, recursive regex list) — kept in one file so tree display and file watching never drift on what's hidden. |
| `src/utils/fileTypes.js` | Extension → `{ type, icon, lang, binary }` classification table. |
| `src/utils/lineMath.js` | Line ↔ string-index conversion (BOM/CRLF/CR-aware), used by the marpNote note-rewriter to translate slide/note positions to byte offsets. |
| `src/utils/version.js` | `getVersion()` — reads `package.json` once, cached. |

### Frontend (`src/static/`) — zero-build, native ESM

`app.js` is the bootstrap entry: it imports every module/lib, defines the
`window.MDV` onclick-handler surface, and runs `init()` on
`DOMContentLoaded`. Everything else is a module with one manager (or one
cohesive concern) per file, imported explicitly — no bundler, no global
registration required (though several also set a `globalThis.MDVXxx` for
`presenter.html`'s inline `<script type="module">`, which can't `import`
from `app.js`).

| Module (`src/static/modules/`) | Role |
|---|---|
| `constants.js` | Frontend-only constants (storage keys, icons, layout sizes). |
| `state.js` | The mutable application-state singleton. |
| `dom.js` | Cached DOM element references (`elements`). |
| `utils.js` | `escapeHtml`, `getFileIcon`, scroll-position helpers. |
| `theme.js` | Light/dark theme toggle + persistence. |
| `pdfStyle.js` | Style panel (CSS/PDF-options selection for `md-to-pdf`). |
| `sidebar.js` | `SidebarManager` + `ResizeHandler` (drag-resize the tree pane). |
| `dialog.js` | Generic modal dialog (confirm/prompt replacement). |
| `shutdown.js` | "Stop server" button → `POST /api/shutdown`. |
| `fileTree.js` | Tree render/expand/load-more, diff-reconcile (not full innerHTML rebuild) on external changes. |
| `websocket.js` | Client WS connection, `tree_update`/`file_update` dispatch. Takes `ContentRenderer`/`InlineNotesPanel`/`PresenterView`/`refreshCurrentTab` via setter injection (see §4). |
| `contentRenderer.js` | Renders markdown/Marp/code/text into the main pane; owns the Marp slide-navigation state (via `marpState.js`). |
| `inlineNotes.js` | The inline (main-window) speaker-notes editor panel under each Marp slide. |
| `presenterView.js` | Presenter View window: 3-pane layout, timer, note editing, `BroadcastChannel` protocol with the main window (see §3.3). |
| `marpState.js` | Shared mutable state (`currentSlide`, `keyHandler`) for the Marp cluster (contentRenderer/inlineNotes/presenterView), since native ESM can't share a bare `let` across modules. |
| `marpSplit.js` | The draggable split handle between the slide pane and the inline notes pane. |
| `marpZoomGlue.js` | DOM glue for pinch-to-zoom/pan on the slide pane (imports the pure math from `lib/marpZoom.js`). |
| `marpDiffIndicator.js` | 0.6.16 — Review-mode-only yellow dot next to the Marp nav's slide counter when the CURRENTLY displayed slide overlaps an added/changed line range. Subscribes to `diffReview.js`'s `onCurrentChange()` seam + `reviewMode.js`'s `onReviewModeChange()`; intersects `/api/diff`'s Marp-only `slideRanges` against `added`/`changed` via the pure `lib/marpDiffMap.js`. The dot element is created/removed outright (never class-hidden) — zero DOM trace while Review is OFF, on non-Marp tabs, or on an unchanged slide. |
| `tabs.js` | Tab open/switch/close, tab-bar rendering. Mutually dependent with `editor.js`. |
| `editor.js` | Edit-mode textarea, autosave (debounced), flush-on-navigate. The most correctness-dense file in the app (in-flight `AbortController`, serialized save tail). |
| `fileOperations.js` | Rename/delete/new-file/new-folder actions. |
| `contextMenu.js` | Right-click context menu on tree items. |
| `dragDrop.js` | Drag-and-drop file upload onto the tree. |
| `keyboard.js` | Global keyboard shortcuts. |
| `print.js` | `Cmd+P` → either `window.print()` or a styled PDF download, depending on whether PDF options are set (see README "PDF Export"). |
| `renderedFile.js` | `applyRenderedFile(tab, data)` — the one place that applies the server's "rendered file" envelope fields (content/raw/fileType/isMarp/css/notes/notesMultiplicity/etag/lineEnding/hasBom) onto a tab object, with consistent per-field fallback rules. Used by `tabs.js`, `websocket.js`, and `editor.js`. |
| `diffReview.js` | Change-tracking review UI (0.6.4-0.6.14) built on `GET /api/diff` + a localStorage baseline (`getLastSeen`/`markSeen`, namespaced by served root). Drives the toolbar's "次の変更 N" + "✓ 確認" buttons (0.6.8 replaced the old standalone `#diffReviewBar` row between the tab bar and content pane with these two static toolbar buttons; 0.6.14 moved them right after `#reviewModeToggle`, renamed 「変更 N」→「次の変更 N」, and — while Review is ON — keeps them permanently mounted, flipping the `disabled` attribute instead of `.hidden` so neighboring toolbar controls never shift; see this module's docstring) and, for non-Marp markdown, `.diff-added`/`.diff-changed` line highlighting (one shared yellow style, 0.6.10) plus an injected `.diff-removed-inline` block per deletion (Word-style strikethrough of the actual deleted text, 0.6.10 — replaced the old `.diff-removed-after` tick) and ⌥↑↓ jump across all three. Visibility of all of it is gated by `reviewMode.js`'s `isReviewMode()` (0.6.12 — replaced 0.6.10's independent `STORAGE_KEYS.REVIEW_MARKUP` highlight sub-toggle); clicking "次の変更 N" now jumps to the next change (same as ⌥↓) instead of toggling. `onSeen()` is the subscription seam `unreadBadges.js` uses to clear a path's unread dot the moment it's confirmed seen; `onCurrentChange()` (0.6.16) is the same-shaped seam `marpDiffIndicator.js` uses, fired on every `_current` (re)assignment via `_setCurrent()`. |
| `reviewMode.js` | 0.6.12 — Word's 校閲/Review tab mental model. Owns the ONE permanent toolbar button (`#reviewModeToggle`) that gates the entire review surface (unread ●/counts/header chip, "次の変更 N"/"✓ 確認", highlights, strikethrough deletions), backed by a single GLOBAL localStorage boolean (`STORAGE_KEYS.REVIEW_MODE`, default OFF) with a one-time migration of 0.6.10's `REVIEW_MARKUP` key. `isReviewMode()`/`onReviewModeChange()` are the read/subscribe seam `diffReview.js` and `unreadBadges.js` both consult — background tracking (baselines, the unread map) keeps running while OFF, only PAINTING is gated. |
| `searchPalette.js` | Cmd/Ctrl+K full-text search overlay backed by `GET /api/search` (`src/services/search.js`). Builds its own DOM subtree in `document.body` (unlike `dialog.js`, which reuses static markup). Enter jumps to the hit: `data-source-line`-based scroll for markdown, proportional scroll for code/text, or just opens the deck for Marp (no per-line mapping yet). |
| `unreadBadges.js` | 0.6.5 unread ● tree badge (the 0.6.5 seen-✓ badge was removed in 0.6.8 — a file that isn't unread now shows no badge at all) + per-directory unread counts + sidebar header chip ("next unread"). Event-driven off the `files_changed` WS feed (§2.2) and `diffReview.js`'s `onSeen()` seam — never hash-scans the tree. Decorates `[data-path]` rows in place after every tree render (wrapped from `app.js`, same pattern as `TabManager.renderActive`). 0.6.12: painting (not tracking) is gated by `reviewMode.js`'s `isReviewMode()`, same as `diffReview.js`. |

| Module (`src/static/lib/`) | Role |
|---|---|
| `apiClient.js` | `MDVApi` — the HTTP client wrapper (URL construction, `If-Match` header, JSON parsing, error normalization). Upload stays on raw XHR (needs `progress` events `fetch()` doesn't expose). |
| `saveQueue.js` | Per-deck save queue with per-`(slideIndex, origin)` coalescing, so an inline save and a Presenter save for the same slide never clobber each other. |
| `tabRegistry.js` | Tab close/switch life-cycle hooks (subscribers register once; `TabManager` fires on close/switch). Prevents a memory leak in per-tab save state. |
| `presenterChannel.js` | **SSOT** for the `BroadcastChannel` name and message-type strings (`TYPES`) between the main window and Presenter View. See §3.3. |
| `errorCodes.js` | Mirrors `src/utils/errors.js`'s `ERROR_STATUS` code *names* (not statuses) for frontend comparisons, plus client-only codes (`NO_DECK`, `COALESCED`, ...). Keep the two files in sync. |
| `debounce.js` | `createDebouncedAction()` factory (schedule/flush/cancel) — used by `inlineNotes.js`; `editor.js`'s autosave is deliberately hand-rolled (documented in its own file) and not on this factory. |
| `marpDiffMap.js` | 0.6.16 — `changedSlideIndices()`: pure intersection of `/api/diff`'s one-based `added`/`changed` line ranges against its Marp-only `slideRanges` (both derived server-side; no second Marp parser in the browser). Consumed by `modules/marpDiffIndicator.js`. Unit-tested without a browser (`tests/test-marp-diff-map.js`). |
| `marpZoom.js` | Pure, DOM-free zoom math (contain-fit, clamp, wheel→zoom) for `marpZoomGlue.js`. Unit-tested without a browser. |
| `notesEditor.js` | `readEditableText()` (contenteditable → newline-preserving text) and `isNotesEditable()` (single-note-per-slide rule), shared by `inlineNotes.js` and `presenter.html`'s inline script. |
| `presenterSaveRouting.js` | `createSaveRouter()` — the Presenter window's save-routing/failover protocol (which main window a note edit routes to, find-saver/saver-here re-pinning, ack-timeout failover, `note-saved` ack classification), extracted DOM-free from `presenter.html`'s inline script for unit-test coverage. Unit-tested without a browser (`tests/test-presenter-save-routing.js`). See §2.3. |

`src/static/vendor/` holds offline copies of highlight.js, mermaid, tailwind,
and html2pdf.js (no CDN dependency — mdv works fully offline). `versions.json`
records what's vendored; `scripts/sync-vendor.js` re-populates it and
`tests/test-vendor-versions.js` asserts no drift against `node_modules`.

## 2. Request / data flow

### 2.1 HTTP routes

| Method | Path | Mutating? | Guarded? | Handler |
|---|---|:-:|:-:|---|
| GET | `/raw/*` | no | — | `api/file.js` |
| GET | `/api/file` | no | — | `api/file.js` |
| POST | `/api/file` | yes | Origin+lock+atomic | `api/file.js` |
| DELETE | `/api/file` | yes | Origin+lock | `api/file.js` |
| POST | `/api/mkdir` | yes | Origin+lock | `api/file.js` |
| POST | `/api/move` | yes | Origin+lock | `api/file.js` |
| GET | `/api/download` | no | — | `api/file.js` |
| GET | `/api/tree` | no | — | `api/tree.js` |
| GET | `/api/tree/expand` | no | — | `api/tree.js` |
| GET | `/api/tree/page` | no | — | `api/tree.js` |
| GET | `/api/search` | no | — | `api/search.js` → `services/search.js` |
| GET | `/api/diff` | no | — | `api/diff.js` → `utils/lineDiff.js` / `services/changeJournal.js` |
| POST | `/api/upload` | yes | Origin | `api/upload.js` |
| POST | `/api/pdf/export` | writes to `os.tmpdir()`, not rootDir | Origin | `api/pdf.js` |
| GET | `/api/info` | no | — | `server.js` |
| POST | `/api/shutdown` | process-level | Origin | `server.js` |
| GET, OPTIONS | `/api/marp/decks/:path` | no | Host (+Origin on OPTIONS) | `api/marpNote.js` → `handleGet.js` |
| PUT, OPTIONS | `/api/marp/decks/:path/slides/:N/note` | yes | Host+Origin+lock+atomic | `api/marpNote.js` → `handlePut.js` |
| GET | `/static/*` | no | — | `express.static` |
| GET | `*` | no | — | SPA catch-all → `index.html` |

"Guarded" = Origin/Host CSRF check via `makeOriginGuard()` (file/upload/
pdf-export/shutdown) or the marpNote routes' own `checkHost`/`checkOrigin`
calls (same rule, see `src/api/middleware/originGuard.js`). If you add a new
file-mutating route, add the same guard — see §4.1.

### 2.2 WebSocket message types

Produced by the server (`src/websocket.js`, `src/watcher.js`), consumed by
`src/static/modules/websocket.js`:

- **`tree_update`** — `{ type: 'tree_update' }`. Broadcast to *all* clients
  when a file/dir is added or removed (debounced 150ms,
  `TREE_UPDATE_DEBOUNCE_MS`), or when `POST /api/file` creates a brand-new
  file (not on every autosave of an existing file — that would be a tree
  storm). Client reaction: `FileTreeManager` re-fetches and diff-reconciles
  the tree (not a full rebuild — preserves scroll/expand/selection state).
- **`file_update`** — `{ type: 'file_update', path, content, raw, fileType,
  isMarp?, css?, notes?, notesMultiplicity?, etag, lineEnding?, hasBom? }`.
  Sent only to clients that are watching `path` (client sends
  `{ type: 'watch', path }` over the socket first). Fired by the watcher on
  a real filesystem `change` event. Client reaction: whichever module owns
  the active tab re-renders (`ContentRenderer`, or the tab's editor state
  via `renderedFile.js`'s `applyRenderedFile`).
  Since 0.6.3, **`etag` is always present** (`makeEtag()` of the raw source)
  for every text-renderable file, not just Marp decks — `src/watcher.js` also
  records this raw content into `app.locals.changeJournal` (see §1 Services)
  BEFORE broadcasting, so a hash a client observed here is usable as the
  `from` param of a later `GET /api/diff` call. See `src/static/modules/
  renderedFile.js`'s docstring for the full per-field presence/fallback
  table (`etag` has been universal, not Marp-only, since 0.6.4).
- **`files_changed`** (0.6.5) — `{ type: 'files_changed', items: [{ path,
  etag?, kind: 'changed'|'added'|'removed' }...] }`. Broadcast to *all* clients
  (`wss.broadcast`, NOT watch-scoped like `file_update`) by `src/watcher.js`,
  coalesced per burst over `FILES_CHANGED_DEBOUNCE_MS` (200ms,
  `src/config/constants.js`) so a bulk FS operation collapses into one
  message — `items` is keyed by path internally, so a path touched more
  than once in one window keeps only its latest kind/etag. This is the
  event-driven feed behind the unread/seen tree badges
  (docs/plan-review-surface-0.6.x.md §③,
  `src/static/modules/unreadBadges.js`) — the client never hash-scans the
  whole tree, it only reacts to this feed plus `diffReview.js`'s
  `getLastSeen()`/`markSeen()` baseline (`onSeen()` subscription seam).
  - `kind: 'changed'` (chokidar `change`) always carries `etag` — the exact
    same raw-content hash that change's `file_update` computes.
  - `kind: 'added'` (chokidar `add`) carries no `etag` and is only sent for
    text-renderable files (`src/utils/fileTypes.js`'s `getFileType()`,
    `!binary`) — a binary addition (image, pdf, ...) never gets a rendered
    pane/etag at all, so there is nothing to track as unread here (it still
    gets the existing `tree_update`).
  - `kind: 'removed'` (chokidar `unlink`) carries no `etag` and is only sent
    for trackable (markdown/code/text) paths — the client forgets the path
    outright (`UnreadBadgesManager` deletes it from its unread map) rather
    than marking it unread, so a deleted file's ghost never lingers in the
    header chip count or `⌥⇧↓` next-unread cycling.
  - Client reaction: `UnreadBadgesManager.handleFilesChanged()` — a
    `changed`/`added` item is unread unless `diffReview.js`'s
    `getLastSeen(path).hash` already equals its `etag`, in which case it is
    simply not-unread (0.6.8 removed the separate seen-✓ badge — there is no
    "confirmed" visual state to paint); an `added` item with no `etag` at
    all is unconditionally unread.

Client → server: only `{ type: 'watch', path }` (replaces, not adds to, that
client's single watched path — see `clientWatches` in `src/websocket.js`).

### 2.3 BroadcastChannel: main window ↔ Presenter View

Channel name and message shapes are the SSOT in
`src/static/lib/presenterChannel.js` (`TYPES`), mirrored by `presenter.html`'s
inline module script (which can't `import` from `app.js`).

```
main → presenter:  slides, index, note-saved, saver-here
presenter → main:  request-slides, goto, edit-note, find-saver
```

- Every main window has a `windowId`. Each `slides` broadcast carries
  `sourceWindowId`; Presenter View pins the first window that can serve the
  current deck, and every subsequent `edit-note` carries that
  `targetWindowId` so only the pinned window performs the save (prevents N
  main windows all racing to save the same deck).
- **Failover**: if the pinned window stops answering, Presenter View
  broadcasts `find-saver`; any main window still holding that deck (active or
  background tab) replies `saver-here` and gets re-pinned.
- Each `edit-note` carries a `requestId` echoed back in the matching
  `note-saved`, so Presenter View can correlate a save result to the request
  that triggered it (concurrent edits to different slides don't cross wires).
- The pinning/failover/ack-classification decisions above are implemented as
  the DOM-free `createSaveRouter()` in `src/static/lib/presenterSaveRouting.js`
  (unit-tested in `tests/test-presenter-save-routing.js`); `presenter.html`'s
  inline script only wires it to `channel.postMessage` and the save-status UI.

## 3. SSOT inventory

| Concept | Single home | Notes |
|---|---|---|
| Error codes / HTTP status / envelope shape | `src/utils/errors.js` | Mirrored client-side (names only) in `src/static/lib/errorCodes.js` — keep both in sync when adding/renaming a code. |
| Cross-module constants (port, depth, size caps, debounce ms) | `src/config/constants.js` | Import, don't re-literal. |
| Ignored files/dirs | `src/utils/ignorePatterns.js` | `isIgnoredName()` (tree) + `CHOKIDAR_IGNORED` (watcher) — two exports, one file, so tree display and watch behavior can't drift. |
| HTML escaping | `src/utils/html.js` | Replaced 3 previously-drifted implementations. |
| ETag format | `src/utils/etag.js` | `sha256:<hex>`. |
| Origin/Host (CSRF) rule | `src/api/middleware/originGuard.js` | `marpNote/guards.js` re-exports from here rather than redefining. |
| Path validation | `src/utils/path.js` | `resolveWithinRoot()` is the one-call helper for route handlers. |
| Atomic write | `src/utils/atomicWrite.js` | Temp file + rename, EXDEV fallback, permission-preserving. |
| Per-path mutex | `src/concurrency/pathLock.js` | FIFO promise chain per key. |
| Marp/Marpit parsing | `src/rendering/marpitAdapter.js` | Frozen contract, snapshot-tested. |
| PDF generation | `src/services/pdf.js` | Shared by the HTTP route and the CLI `convert` command. |
| `tree_update` payload construction | `src/websocket.js`'s `broadcastTreeUpdate()` | Both `watcher.js` and `file.js` call this rather than building the object inline. |
| Rendered-file envelope → tab object | `src/static/modules/renderedFile.js` | `applyRenderedFile()`, used by 3 call sites (tabs/websocket/editor). |
| Review-mode on/off (gates unread badges/diff highlights/strikethrough) | `src/static/modules/reviewMode.js` | Single GLOBAL `STORAGE_KEYS.REVIEW_MODE` boolean, default OFF. `isReviewMode()`/`onReviewModeChange()` are the read/subscribe seam `diffReview.js` and `unreadBadges.js` both consult — background tracking keeps running while OFF, only painting is gated. |
| BroadcastChannel channel name + message types | `src/static/lib/presenterChannel.js` | Mirrored (values only) by `presenter.html`'s inline script. |
| Presenter save-routing/failover decisions (pin/find-saver/ack-timeout/note-saved classification) | `src/static/lib/presenterSaveRouting.js` | `createSaveRouter()`, DOM-free; `presenter.html` wires it to the channel + save-status UI. |
| Marp cluster shared state (`currentSlide`, `keyHandler`) | `src/static/modules/marpState.js` | Get/set accessors, since native ESM can't share a bare `let`. |
| `mdv.config.json` loading | `src/cli/config.js` | Consumed by `src/cli/registry.js` (viewer) and `src/cli/convert.js`. |
| Version string | `src/utils/version.js` | Reads `package.json` once, cached. |
| Frontend HTTP calls | `src/static/lib/apiClient.js` (`MDVApi`) | Documented exception: upload uses raw XHR for progress events. |

## 4. How to extend

### 4.1 Add a new API route

1. Pick the owning file under `src/api/` (or create one, and call its setup
   function from `src/server.js`'s `setupApiRoutes()`).
2. Validate any path input via `resolveWithinRoot()` /
   `validatePathReal()` (`src/utils/path.js`) — never `path.join` a raw
   user-supplied path without validation.
3. If the route mutates anything (writes/deletes/moves/creates), add
   `makeOriginGuard()` from `src/api/middleware/originGuard.js` as
   middleware (no options — it reads `req.app.locals.allowedHosts`).
4. If the route writes a file, use `atomicWrite()` + `withLock(fullPath, ...)`.
5. Every error response goes through `sendError(res, mkError(CODE, message))`
   — add a new `CODE`/status pair to `src/utils/errors.js`'s `ERROR_STATUS`
   if none of the existing ones fit. Never `res.status().json()` inline.
6. Any new literal (size limit, timeout, cap) goes in
   `src/config/constants.js`, not inline.
7. Add tests: a `tests/test-*.js` file using `tests/helpers/server.js`'s
   `startTestServer()` for the happy path + the Origin-guard/path-validation
   rejection cases (see `tests/test-file-guards.js` / `tests/test-origin-guard.js`
   for the pattern). Update `docs/ARCHITECTURE.md`'s HTTP routes table (§2.1).

### 4.2 Add a frontend manager module

1. Create `src/static/modules/yourThing.js` exporting a single object (the
   convention: `export const YourThingManager = { init(), ... }`).
2. Import `state`/`elements` from `modules/state.js`/`modules/dom.js` as
   needed; import `MDVApi` from `lib/apiClient.js` for any HTTP call (don't
   use raw `fetch`, except the documented XHR-upload exception).
3. If it needs to call into a module that isn't extracted yet, or would
   create an import cycle at module-eval time, use setter injection: expose
   `setXxx(fn)` on your module, and wire it once in `app.js`'s `init()` —
   see `modules/websocket.js`'s docstring and `app.js`'s `init()` for the
   pattern. (A cycle where both sides only call each other from inside
   async method/event-handler bodies — never at module-eval time — is safe
   for native ESM and does not need setter injection; see `modules/tabs.js`
   ↔ `modules/editor.js`.)
4. Import the module in `app.js` and call `YourThingManager.init()` inside
   `init()`.
5. No build step — the browser loads your file directly as an ES module.
   Verify in a real browser (Playwright) before considering the change done.

### 4.3 Add a CLI subcommand

1. Create `src/cli/yourCommand.js` exporting an options spec (for
   `node:util`'s `parseArgs`), a `showYourCommandHelp()`, and an async
   `run({ values, positionals })` returning a Promise of an exit code
   (`number`) — or `undefined` if the command should keep the process alive
   (like the viewer's server). Never call `process.exit()` — throw
   `UsageError` (`src/cli/errors.js`) for argument-validation failures
   instead, so `bin/mdv.js`'s `main()` stays the only exit point.
2. Add an entry to the `commands` table in `src/cli/registry.js`:
   `{ options, allowPositionals, help, run }`. `main()`/`dispatch()` never
   need to change.
3. If your command should read `mdv.config.json`, call `loadConfig()`
   (`src/cli/config.js`) yourself — precedence is always **CLI flags >
   config file > `src/config/constants.js` defaults**, resolved by your
   command, not by the registry.
4. Add unit tests under `tests/test-cli-yourCommand.js` (see
   `tests/test-cli-convert.js` for the pattern — dependencies like the PDF
   exporter are injectable via a `deps` param so tests don't spawn real
   subprocesses).

### 4.4 `mdv.config.json`

Optional file, looked up in the served directory (viewer command) or the
current working directory (`mdv convert`, which has no "served directory").
Loaded by `src/cli/config.js`.

| Key | Type | Same as flag |
|---|---|---|
| `port` | number | `-p`/`--port` |
| `depth` | number | `-d`/`--depth` |
| `open` | boolean | inverse of `--no-browser` |
| `css` | string (path, resolved relative to the config file) | `-s`/`--style` |
| `pdfOptions` | string (path, resolved relative to the config file) | `--pdf-options` |

**Precedence: CLI flags > `mdv.config.json` > built-in defaults**
(`src/config/constants.js`). Unknown keys log a `console.warn` and are
ignored (not a hard error) — a config file is optional convenience, not a
strict schema contract. Malformed JSON, or JSON that isn't a plain object,
throws `UsageError` naming the file.
