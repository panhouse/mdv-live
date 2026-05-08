# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.10] - 2026-05-09

### Fixed (UX revert)

- **Markdown PDF ボタンを OS 印刷ダイアログに戻す** (本来の UX 復元):
  - 0.5.9 (実体は 2026-01-31 `e5526f9` から) で plain Markdown も server-side
    md-to-pdf 経由の PDF DL に切り替わっていたが、本来の UX は `Cmd+P` 相当の
    OS 印刷ダイアログ (`window.print()`) で「PDF として保存」を選ぶフロー
  - `src/static/app.js`: `print()` の markdown 分岐を削除 (`else` 分岐の
    `browserPrint()` に落ちる)
  - Marp / HTML preview の挙動は変更なし (server-side marp-cli を維持)

### Fixed (codex review)

- `/api/pdf/export` の `fs.readFile` を `try/catch` 外で実行していた問題を修正
  (directory 指定や読み取り不可ファイルで Express デフォルトエラーに落ちて
  controlled JSON が返らなかった)。stat による file 判定を追加

### Removed

- `PdfStyleManager` UI モジュール (markdown が server PDF を使わなくなったため
  orphan)、`pdfStyleToggle` / `pdfStylePanel` HTML、関連 CSS、`normalizeUserPath`
  helper、`pdf-style-preview` クラス
- `md-to-pdf` runtime dependency。web UI で使わなくなったため削除。
  `bin/mdv.js convert` は元々 `npx md-to-pdf` 経由で 0.5.9 以前と同じ挙動
- `/api/pdf/export` の markdown 分岐 (Marp 専用エンドポイントに整理)。
  非 Marp ファイルは 415 で拒否

### Tests

- 241 → **242 件 (+1)**、全 PASS
- 追加: directory path → 404 controlled JSON (codex round 3 regression)
- 変更: plain markdown PDF テスト → 415 テストに置換

## [0.5.9] - 2026-05-09

### Fixed

- **PDF export hang for plain Markdown** (regression since 2026-01-31 `e5526f9`):
  - 原因 1: `md-to-pdf` が `package.json` に未宣言だったため `npx md-to-pdf` 経路に
    依存。npx キャッシュ / TTY / レジストリ状況により挙動が不安定
  - 原因 2: `child_process.execFile` は `stdio` オプションを受け付けない (Node 仕様)。
    `md-to-pdf` 内部の `get-stdin` が EOF を待ち続け 180s SIGTERM していた
  - 直し方: `md-to-pdf` を `dependencies` に追加 / `npx` 経由をやめて
    `node_modules/.bin/md-to-pdf` を直接 spawn / `stdio: ['ignore', ...]` で stdin 即 EOF
  - Marp 経路 (`marp-cli`) も同じ helper (`runPdfTool`) に統一して防御

### Added

- `tests/test-pdf-export.js`: PDF export 経路の自動テスト 5 件 (400 / 403 / 404 / plain
  PDF / Marp PDF)。リグレッション再発防止

### Tests

- 236 → **241 件 (+5)**、全 PASS

## [0.5.8] - 2026-05-08

### Fixed

- **Symlink TOCTOU on note auto-save** (codex-loop で 4 round 連鎖修正):
  - 旧コードの TOCTOU guard が `earlyDeck.realPath` (lock 取得前) と比較
    していた → 進入後 swap、戻し、書き込みで別ファイル読み出しが original
    path に書ける race を塞ぐため `deck.realPath` (in-lock) と比較に修正
  - in-lock で realpath が変わったら mutex 範囲外の書込みになる →
    detection を入れて再 lock 取得
  - 再 lock 取得を server-side 自動 retry で実装 (client は STALE 以外を
    terminal 扱いするため)
  - retarget retry の入れ子 lock が opposite retarget で deadlock し得る
    → trampoline で **outer lock 解放後に新 realpath を取得**

### Added

- TOCTOU 正常系の API regression test
- SaveQueue coalesce/serialize/dropPath/例外耐性 5 件
- Sec-Fetch-Site=same-origin の B 受理パス + cross-site 拒否

### Architecture (refactor)

- `src/api/marpNote.js` orchestration を 38 行に。実装は `src/api/marpNote/`
  配下の `guards.js` / `readDeck.js` / `handleGet.js` / `handlePut.js` に分割
- `src/static/lib/saveQueue.js` (per-deck queue + per-slide coalesce、純 JS)
- `src/static/lib/tabRegistry.js` (tab close hook → メモリリーク解消)
- `src/static/lib/apiClient.js` を deck/file/tree/info/pdf 用に拡張、
  app.js の fetch 直叩きを 13 → 2 (WebSocket / /raw/ のみ残存)
- `src/concurrency/pathLock.js`: promise-chain ベースの正しい mutex
  (旧 naive Map 実装の thundering-herd race を排除)
- `src/utils/errors.js`: mkError + ERROR_STATUS テーブル + sendError SSOT
- `src/utils/etag.js`: ETag 計算 SSOT
- placeholder を CSS pseudo-element 化 (`:empty::before`) で
  contenteditable に placeholder text が混入する罠を構造的に解消
- STALE 通知時に編集テキストを localStorage に自動退避

### Tests

- 222 → **236 件 (+14)**、全 PASS

## [0.5.7] - 2026-05-08

### Added

- **Presenter View** (Marp スピーカーノート別ウィンドウ表示・編集)
  - P キー (Cmd/Ctrl 修飾なし) または Marp ナビボタンで起動
  - Current / Next スライド + Speaker Notes + 経過タイマーを並列表示
  - パネルサイズはドラッグハンドルで変更可能 (localStorage 永続化)
  - BroadcastChannel `mdv-marp-presenter` でメイン⇄presenter 双方向同期
- **スピーカーノートの自動保存**: presenter ノートパネルをクリック→編集→
  800ms デバウンスでサーバへ PUT。ソース markdown の HTML コメントを書き換え
- **`/api/marp/decks/:path` エンドポイント** (GET/PUT/OPTIONS)
  - **ETag 楽観ロック** (`sha256:`) で外部編集との衝突検出
  - **per-path 非同期 mutex** で同時 PUT を直列化
  - **Multi-note Guard**: 1 slide に複数ノートがある場合は read-only
  - **CSRF**: Origin + Sec-Fetch-Site + Content-Type 厳密検証
  - **PNA preflight 拒否** (localhost 同一オリジン要求)
  - **128KB body limit + 専用 413 ハンドラ** で情報漏洩防止

### Architecture

- Marp スライド範囲・ノート位置の特定を **Marpit token** に委譲する
  `marpitAdapter` を新設。regex 再実装の脆弱性を構造的に解消
- `validatePathReal` + `O_NOFOLLOW` + realpath 二重解決で symlink swap
  best-effort 防御
- `atomicWrite` で `O_EXCL` temp + chmod EPERM 限定 + EXDEV 二段 rename +
  uid+mtime sweep
- BOM/CRLF/CR/UTF-8 surrogate pair 安全な行↔バイト変換ヘルパに集約
- 共通 error コード/HTTP status マッピングを `utils/errors.js` に SSOT 化
- promise-chain ベースの正しい mutex (`concurrency/pathLock.js`) で
  thundering-herd race を排除
- HTTP client / BroadcastChannel 名 / message schema を専用ライブラリに分離
- セキュリティ脆弱性 5 件 (basic-ftp / ip-address / postcss) を `npm audit fix`

### Tests

- 既存 119 → **228 件 (+109)** すべて PASS
- 性能: 500 slides / 155 KiB ファイルで parseDeck+rewrite 86ms

## [0.5.6] - 2026-04-27

### Added

- Markdown PDF変換用の `mdv convert` サブコマンドを追加
- `-s <css-file>` によるPDF変換用CSS指定を追加
- `--pdf-options <json-file>` によるPuppeteer PDF options指定を追加
- Web UIのStyleパネルを追加
  - CSSファイルパスを指定可能
  - PDF options JSONファイルパスを指定可能
  - 指定CSSをMarkdownプレビューに反映
  - `Clear` でスタイル指定を解除可能
- 通常MarkdownのWeb UI PDF exportを `md-to-pdf` に対応
- PDFスタイル指定のサンプルを追加
  - `src/styles/report.example.css`
  - `src/styles/report.pdf-options.example.json`

### Changed

- PDF出力設定をCSSとPDF options JSONに分離
- Marp PDF出力は従来どおりMarp CLIを使用し、通常Markdown PDF出力のみ `md-to-pdf` を使用

## [0.5.5] - 2026-04-05

### Fixed

- タスクリストのインライン要素（太字・リンク・コード）が二重表示されるバグを修正
  - markdown-it-task-lists の labelAfter オプション誤用が原因
- Mermaidプレースホルダがユーザーコンテンツと衝突する問題を修正（nonce付与）
- 空frontmatter（`---\n\n---`）で空のyamlコードブロックが生成される問題を修正

### Removed

- 未使用の `src/rendering/slides.js` を削除（marp.jsに統合済み）

### Added

- WebSocketテスト7件（接続追跡・watch・broadcast・通知・cleanup・不正入力耐性）
- レンダリングテスト10件（strikethrough・CJK emphasis・linkify・breaks・mermaid edge cases）
- テスト総数: 92 → 109

## [0.5.4] - 2026-04-04

### Fixed

- 4件の依存関係脆弱性を修正

## [0.5.3] - 2026-03-29

### Fixed

- Security: exec/execSync → execFile/process.kill でコマンドインジェクション防止（PDF生成・サーバーkill）
- Security: PIDバリデーション厳密化（数字のみ許可、部分一致を拒否）
- Range Requestのバリデーション追加（不正ヘッダで416、end超過はRFC準拠でclamp）
- ファイル監視の再描画でrelativeDirを渡すように修正（サブフォルダ内Markdownの画像パス解決）
- バージョン表示をpackage.jsonから動的取得に統一（CLI・サーバー・テスト全箇所）

## [0.5.2] - 2026-03-27

### Fixed

- CJK + Unicode句読点で太字・斜体が壊れる問題を修正

## [0.5.1] - 2026-03-20

### Fixed

- Edit mode + PDF export bug: exporting PDF while in edit mode produced raw markdown text instead of rendered slides
  - Now auto-exits edit mode before PDF generation
  - Uses `tab.isMarp` fallback for Marp detection when DOM is not yet rendered

## [0.4.3] - 2026-02-15

### Fixed

- macOS app: Japanese filenames garbled when opening via Finder double-click
  - `osascript open location` corrupted UTF-8 characters in URL
  - Now URL-encodes filename with `python3 urllib.parse.quote()` and uses `open` command

## [0.3.3] - 2026-01-31

### Fixed

- Print preview missing padding on markdown content

## [0.3.2] - 2026-01-31

### Changed

- Refactored codebase with extracted helper functions and constants
- Simplified CSS with consolidated variables (--success, --warning, --danger)
- Reduced styles.css by 84 lines, app.js by 45 lines
- Added ARIA attributes for improved accessibility
- Standardized test helpers and imports

### Fixed

- File tree not updating on file structure changes (add/delete/rename)

## [0.3.1] - 2026-01-31

### Changed

- Minor code cleanup and organization

## [0.3.0] - 2026-01-31

### Added

- Initial Node.js version (rewrite from Python mdv-live)
- Express server with WebSocket for live reload
- markdown-it for standard Markdown rendering
- @marp-team/marp-core for Marp slide rendering
- File tree navigation with lazy loading
- Edit mode with textarea editor
- Dark/Light theme support
- Syntax highlighting with highlight.js
- Mermaid diagram support
- PDF output via browser print
- File operations (create, delete, rename, move, upload)
- Keyboard shortcuts for common actions
- Task list (checkbox) support with markdown-it-task-lists
- Range Request support for video/audio streaming
- WebSocket tree_update broadcast for multi-client sync
- Comprehensive security tests (76 tests)

### Security

- Path traversal prevention (absolute path, `..`, null byte)
- Filename sanitization for uploads
- Unified validatePath() for all API endpoints

### Marp Features

- Full compatibility with marp-core
- Official themes: default, gaia, uncover
- All directives: paginate, header, footer, backgroundColor, etc.
- Background images and split backgrounds
- KaTeX math support
- Slide navigation with arrow keys

### CLI Features

- Port auto-increment when port is in use
- Server list (`mdv -l`)
- Server kill (`mdv -k PID` or `mdv -k -a`)
- PDF conversion (`mdv --pdf file.md`)
- No-browser mode (`mdv --no-browser`)
