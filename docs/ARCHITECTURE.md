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
| `src/watcher.js` | chokidar wrapper. On `change`, re-renders the file and broadcasts `file_update` to clients watching that path. On add/unlink (file or dir), debounces and broadcasts `tree_update`. |
| `src/websocket.js` | `ws` server setup: per-client "watch" registry (`clientWatches`), `wss.broadcast()` (all clients), `wss.broadcastFileUpdate()` (only clients watching that path), and `broadcastTreeUpdate()` (the one place the `tree_update` payload is constructed). |

### API routes (`src/api/`)

| Module | Routes | Role |
|---|---|---|
| `src/api/file.js` | `GET /raw/*`, `GET/POST/DELETE /api/file`, `POST /api/mkdir`, `POST /api/move`, `GET /api/download` | File CRUD. Mutating routes are Origin-guarded and per-path locked; save goes through `atomicWrite`. Download supports HTTP Range for video/audio streaming. |
| `src/api/tree.js` | `GET /api/tree`, `GET /api/tree/expand`, `GET /api/tree/page` | File tree listing. Eagerly loads only one level deep (`MAX_INITIAL_DEPTH`); directories beyond `MAX_CHILDREN_PER_DIR` children are paginated via `/api/tree/page`. |
| `src/api/upload.js` | `POST /api/upload` | multer disk-storage upload. Destination directory is realpath-validated before multer touches disk; Origin-guarded. |
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

### Services, styles, concurrency, utils

| Module | Role |
|---|---|
| `src/services/pdf.js` | Actual PDF generation (spawns `marp-cli` / `md-to-pdf`). Shared by `src/api/pdf.js` (HTTP) and `src/cli/convert.js` (CLI) so both paths get the same bug fixes/security checks. Throws `PDF_TOOL_UNAVAILABLE` when an optional dependency is missing. |
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
| `tabs.js` | Tab open/switch/close, tab-bar rendering. Mutually dependent with `editor.js`. |
| `editor.js` | Edit-mode textarea, autosave (debounced), flush-on-navigate. The most correctness-dense file in the app (in-flight `AbortController`, serialized save tail). |
| `fileOperations.js` | Rename/delete/new-file/new-folder actions. |
| `contextMenu.js` | Right-click context menu on tree items. |
| `dragDrop.js` | Drag-and-drop file upload onto the tree. |
| `keyboard.js` | Global keyboard shortcuts. |
| `print.js` | `Cmd+P` → either `window.print()` or a styled PDF download, depending on whether PDF options are set (see README "PDF Export"). |
| `renderedFile.js` | `applyRenderedFile(tab, data)` — the one place that applies the server's "rendered file" envelope fields (content/raw/fileType/isMarp/css/notes/notesMultiplicity/etag/lineEnding/hasBom) onto a tab object, with consistent per-field fallback rules. Used by `tabs.js`, `websocket.js`, and `editor.js`. |

| Module (`src/static/lib/`) | Role |
|---|---|
| `apiClient.js` | `MDVApi` — the HTTP client wrapper (URL construction, `If-Match` header, JSON parsing, error normalization). Upload stays on raw XHR (needs `progress` events `fetch()` doesn't expose). |
| `saveQueue.js` | Per-deck save queue with per-`(slideIndex, origin)` coalescing, so an inline save and a Presenter save for the same slide never clobber each other. |
| `tabRegistry.js` | Tab close/switch life-cycle hooks (subscribers register once; `TabManager` fires on close/switch). Prevents a memory leak in per-tab save state. |
| `presenterChannel.js` | **SSOT** for the `BroadcastChannel` name and message-type strings (`TYPES`) between the main window and Presenter View. See §3.3. |
| `errorCodes.js` | Mirrors `src/utils/errors.js`'s `ERROR_STATUS` code *names* (not statuses) for frontend comparisons, plus client-only codes (`NO_DECK`, `COALESCED`, ...). Keep the two files in sync. |
| `debounce.js` | `createDebouncedAction()` factory (schedule/flush/cancel) — used by `inlineNotes.js`; `editor.js`'s autosave is deliberately hand-rolled (documented in its own file) and not on this factory. |
| `marpZoom.js` | Pure, DOM-free zoom math (contain-fit, clamp, wheel→zoom) for `marpZoomGlue.js`. Unit-tested without a browser. |
| `notesEditor.js` | `readEditableText()` (contenteditable → newline-preserving text) and `isNotesEditable()` (single-note-per-slide rule), shared by `inlineNotes.js` and `presenter.html`'s inline script. |

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
  isMarp?, css?, notes?, notesMultiplicity?, etag?, lineEnding?, hasBom? }`.
  Sent only to clients that are watching `path` (client sends
  `{ type: 'watch', path }` over the socket first). Fired by the watcher on
  a real filesystem `change` event. Client reaction: whichever module owns
  the active tab re-renders (`ContentRenderer`, or the tab's editor state
  via `renderedFile.js`'s `applyRenderedFile`).

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
| BroadcastChannel channel name + message types | `src/static/lib/presenterChannel.js` | Mirrored (values only) by `presenter.html`'s inline script. |
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
