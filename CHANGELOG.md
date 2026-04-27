# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
