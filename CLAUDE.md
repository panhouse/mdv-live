# MDV - Claude Code Instructions

## Overview

MDV (`mdv-live`) is a Node.js + Express Markdown viewer: file tree, live preview
(WebSocket hot-reload), full Marp slide support (Presenter View, inline speaker
notes, PDF export), and a `mdv` CLI. Zero-build: the frontend is native ES
modules (`<script type="module">`), no bundler.

This file is the primary map for AI agents working in this repo. For the deep
module inventory, request/data flow, and "how to extend" checklists, see
**`docs/ARCHITECTURE.md`**. For the refactor history/rationale, see
`docs/refactoring-2026-07-strategy.md`.

## Quick Commands

```bash
npm install           # install dependencies
npm test              # unit/integration tests (node --test) — must be all-PASS
npm run test:e2e      # Playwright E2E smoke suite — must be all-PASS
npm run lint          # eslint . — must be clean
npm run dev           # start the viewer server (node bin/mdv.js)
npm link              # register the `mdv` global command
```

Never hardcode a test count in any doc (CLAUDE.md, README, CHANGELOG, PRs).
Counts drift every time a test file is added; say "npm test must be all-PASS"
instead. (A prior version of this file said "76 tests" while the suite had
grown past 300 — don't repeat that.)

## Architecture

```
bin/mdv.js                 # Thin CLI entry: parse argv → src/cli dispatch →
                            #   process.exit(). The ONLY place that exits.
src/
├── cli/                   # CLI logic, unit-testable (no process.exit here)
│   ├── registry.js        #   subcommand table + dispatch (OCP: new command
│   │                      #   = new table entry, main() never changes)
│   ├── config.js          #   mdv.config.json loader
│   ├── convert.js         #   `mdv convert` (md/Marp → PDF)
│   ├── resolveTarget.js   #   positional path arg → { rootDir, initialFile }
│   ├── serverRegistry.js  #   `mdv -l` / `mdv -k` (lsof/ps/kill wrappers)
│   └── errors.js          #   UsageError — throw, never process.exit()
├── config/
│   └── constants.js       # SSOT: DEFAULT_PORT (8642), depth/size caps,
│                          #   debounce timings, body-size limits
├── server.js              # createMdvServer(): Express app + routes + WS +
│                          #   watcher wiring; owns app.locals.allowedHosts
├── watcher.js              # chokidar → tree_update / file_update broadcasts
├── websocket.js             # ws server, per-client "watch" registry, broadcast helpers
├── api/
│   ├── file.js             # GET/POST/DELETE /api/file, /raw/*, mkdir, move, download
│   ├── tree.js              # /api/tree, /api/tree/expand, /api/tree/page
│   ├── upload.js            # POST /api/upload (multer, disk storage)
│   ├── pdf.js                # POST /api/pdf/export
│   ├── diff.js                # GET /api/diff (change-tracking line diff; read-only, no Origin guard)
│   ├── search.js              # GET /api/search (full-text search; read-only, no Origin guard)
│   ├── marpNote.js           # /api/marp/decks/:path routing (orchestration only)
│   ├── marpNote/
│   │   ├── guards.js         #   Content-Type / If-Match / slide-index / note validation
│   │   ├── readDeck.js       #   path-safe deck read (realpath-verified)
│   │   ├── handleGet.js      #   GET /api/marp/decks/:path
│   │   └── handlePut.js      #   PUT .../slides/:N/note (optimistic lock + mutex)
│   └── middleware/
│       └── originGuard.js    # SSOT Origin/Host (CSRF) check — makeOriginGuard()
├── rendering/
│   ├── index.js               # renderFile(): dispatch by file type + media path rewriting
│   ├── markdown.js             # markdown-it (CJK emphasis fix, task lists, mermaid guard)
│   ├── marp.js                 # thin compat wrapper over marpitAdapter.renderDeck
│   ├── marpitAdapter.js        # SSOT Marp/Marpit wrapper (slide/notes token normalization)
│   ├── marpNoteWriter.js       # pure function: splice a speaker note into raw markdown
│   └── office.js               # xlsx/pptx/docx "vibe preview": OOXML unzip (fflate) + tolerant-regex text extraction
├── services/
│   ├── pdf.js                  # PDF generation (marp-cli / md-to-pdf); shared by API + CLI
│   ├── changeJournal.js         # in-memory raw-content snapshot store keyed by content hash; backs /api/diff
│   └── search.js                # full-text search implementation; backs /api/search
├── styles/                      # PDF style presets + resolution + example CSS/JSON
├── concurrency/
│   └── pathLock.js              # withLock(): promise-chain mutex keyed by path
├── utils/                       # SSOT modules — see table below
└── static/                      # Frontend. Zero-build, native ESM.
    ├── index.html / presenter.html / styles.css
    ├── app.js                    # bootstrap entry (~250 lines): imports + init()
    ├── modules/                  # one manager per module, see docs/ARCHITECTURE.md for the full list
    ├── lib/                      # DOM-free / cross-cutting: apiClient, saveQueue,
    │                             #   tabRegistry, presenterChannel, errorCodes,
    │                             #   debounce, marpZoom, notesEditor,
    │                             #   presenterSaveRouting
    └── vendor/                   # offline-vendored highlight.js/mermaid/tailwind/
                                  #   html2pdf + versions.json (see sync-vendor.js)
tests/
├── *.js                          # unit/integration (node --test), one server
│                                 #   per file via tests/helpers/server.js
└── e2e/                          # Playwright specs (npm run test:e2e)
```

## Key Conventions (a future agent MUST follow these)

1. **Errors only via `sendError`/`mkError`** (`src/utils/errors.js`) +
   `ERROR_STATUS`. Never write `res.status(...).json(...)` inline in a route —
   add a code to `ERROR_STATUS` if the one you need doesn't exist yet. The
   response envelope is always `{ ok: false, code, error }`.
2. **Constants live in `src/config/constants.js`.** Don't reintroduce a
   hardcoded port/depth/size-limit/debounce literal — import it.
3. **Every mutation route is Origin/Host-guarded.** Use
   `makeOriginGuard()` from `src/api/middleware/originGuard.js` with no
   options — it reads `req.app.locals.allowedHosts` per request (the
   contract `createMdvServer` maintains in `src/server.js`, refreshed with
   the real bound port on `start()`). This currently covers file
   save/delete/mkdir/move, upload, shutdown, and the marpNote PUT route
   (via its own `checkHost`/`checkOrigin` calls, same rule). If you add a
   new route that writes/deletes/moves anything, guard it the same way.
4. **Writes go through `atomicWrite` + `withLock`** (`src/utils/atomicWrite.js`,
   `src/concurrency/pathLock.js`) — temp file + rename (EXDEV-safe), and a
   per-path promise-chain mutex so concurrent writes to the same file never
   interleave.
5. **Paths are validated via `resolveWithinRoot`/`validatePathReal`**
   (`src/utils/path.js`) — symlink-aware, rejects traversal/absolute/null-byte
   paths. Don't hand-roll a new path-join-and-hope check.
6. **The ignore list lives in `src/utils/ignorePatterns.js`** — `isIgnoredName`
   (tree.js, single-level) and `CHOKIDAR_IGNORED` (watcher.js, recursive) must
   stay in sync; that's why they're one module. Don't add a third copy.
7. **Frontend: one manager per module, pure ESM, zero build step.** New
   frontend features get a new file under `src/static/modules/` (or
   `src/static/lib/` if it's DOM-free/reusable), imported by `app.js`. Where a
   module needs something not-yet-extracted (or would otherwise create an
   import cycle), wire it via setter injection at bootstrap — see `app.js`'s
   `init()` (`WebSocketManager.setContentRenderer(...)` etc.) and the
   docstrings in `modules/theme.js` / `modules/websocket.js` for the pattern.
8. **Never hardcode test counts in docs.** See Quick Commands above.

## SSOT Quick Reference

| Concept | Single home |
|---|---|
| Error codes / HTTP status / response envelope | `src/utils/errors.js` (mirrored client-side in `src/static/lib/errorCodes.js`) |
| Cross-module constants (port, depth, size caps, debounce) | `src/config/constants.js` |
| Ignored files/dirs (tree + watcher) | `src/utils/ignorePatterns.js` |
| HTML escaping | `src/utils/html.js` |
| ETag format (`sha256:<hex>`) | `src/utils/etag.js` |
| Origin/Host (CSRF) rule | `src/api/middleware/originGuard.js` |
| Path validation | `src/utils/path.js` |
| Atomic file write | `src/utils/atomicWrite.js` |
| Per-path mutex | `src/concurrency/pathLock.js` |
| Marp/Marpit parsing | `src/rendering/marpitAdapter.js` |
| PDF generation (API + CLI share it) | `src/services/pdf.js` |
| BroadcastChannel message types (main ↔ Presenter) | `src/static/lib/presenterChannel.js` |
| `mdv.config.json` loading | `src/cli/config.js` |
| Review-mode on/off (gates unread badges/diff highlights/strikethrough) | `src/static/modules/reviewMode.js` (`STORAGE_KEYS.REVIEW_MODE`) |

See `docs/ARCHITECTURE.md` for the full inventory and request/data-flow maps.

## Security

**Origin/Host guard** (`src/api/middleware/originGuard.js`): CSRF / DNS-rebinding
defense applied to mutation routes.
- **Host**: the request's `Host` header must be `localhost:<port>` or
  `127.0.0.1:<port>` for the server's actual bound port. Missing/mismatched →
  rejected.
- **Origin**: if an `Origin` header is present, it must be
  `http://<one of the allowed hosts>`. If absent, the request is allowed only
  when `Sec-Fetch-Site: same-origin` is present.
- Host is checked before Origin. Rejection → `403 ORIGIN_REJECTED` via
  `sendError`. A guard with no configured allow-list fails closed (rejects),
  it never fails open.

**Path validation** (`src/utils/path.js`):
- `validatePath()` rejects null bytes, absolute paths, and any `..`
  component, then verifies the resolved path stays within `rootDir`.
- `validatePathReal()` additionally resolves symlinks (`fs.realpath`) so a
  symlink whose target escapes `rootDir` is rejected even if the link itself
  lives inside `rootDir`. Walks up to the nearest existing ancestor for
  not-yet-created paths (e.g. a new file's parent directory).
- `resolveWithinRoot()` is the one-call helper (`{ valid, fullPath }`) route
  handlers should use — it wraps `validatePathReal` and resolves the
  absolute path in one step.

**Default port**: `8642` (`src/config/constants.js` `DEFAULT_PORT`). The CLI
auto-increments if it's taken.

## Testing

```bash
npm test          # node --test tests/*.js — unit + integration, all-PASS required
npm run test:e2e  # playwright test — E2E smoke suite, all-PASS required
npm run lint      # eslint . — clean required
```

Integration tests boot a real server per test file via
`tests/helpers/server.js` (`startTestServer`) against an `fs.mkdtemp()` fixture
directory on an OS-assigned ephemeral port — never against the repo itself.
E2E specs (`tests/e2e/*.spec.js`) do the same via `tests/e2e/helpers.js`.

Frontend changes are not "done" on `npm test` passing alone — verify in a real
browser (Playwright) before considering the change complete.

## Coding Rules

- ES Modules (`import`/`export`) throughout, including the frontend.
- Async via `async/await`.
- Errors are handled explicitly — never swallowed silently (see Key
  Conventions #1).
- Security-relevant changes (path handling, Origin/Host guard, error
  messages that might leak fs details) get a test added in the same change.

## mdv.config.json (product config file)

Optional `mdv.config.json` in the served directory (viewer) or CWD (`mdv
convert`). Precedence: **CLI flags > mdv.config.json > built-in defaults**
(`src/config/constants.js`). Loaded by `src/cli/config.js`. Keys: `port`,
`depth`, `open`, `css`, `pdfOptions` (see `docs/ARCHITECTURE.md` for details;
unknown keys warn and are ignored, not a hard error).

## Dependencies

- `express` — HTTP server · `ws` — WebSocket · `chokidar` — file watching
- `markdown-it` + `markdown-it-task-lists` — Markdown rendering
- `@marp-team/marp-core` — Marp slide rendering
- `multer` (2.x) — file uploads
- `mime-types` — MIME type detection
- `fflate` — OOXML unzip for the Office "vibe preview" (`src/rendering/office.js`)
- `highlight.js` — server-side theme lookup for PDF export syntax highlighting (`src/services/pdf.js`, `src/styles/index.js`); also vendored separately for the browser (see `src/static/vendor/`)
- `open` — auto-launches the browser on `mdv` startup (disabled by `--no-browser`)
- Optional (PDF export): `@marp-team/marp-cli`, `md-to-pdf`
