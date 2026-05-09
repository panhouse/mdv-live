# MDV - Markdown Viewer with Marp Support

ファイルツリー + ライブプレビュー + Marp完全対応のMarkdownビューア

[![npm version](https://badge.fury.io/js/mdv-live.svg)](https://www.npmjs.com/package/mdv-live)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 📁 左側にフォルダツリー表示（遅延読み込み対応）
- 📄 Markdownをリアルタイムレンダリング
- 🎬 **Marp完全対応**（公式テーマ・ディレクティブ・数式）
- 🎤 **Presenter View**（スピーカーノート別ウィンドウ・自動保存・タイマー） — `P` キーで起動
- 🔄 ファイル更新時に自動リロード（WebSocket）
- 🎨 シンタックスハイライト（highlight.js）
- 📊 Mermaid図のレンダリング
- 🌙 ダーク/ライトテーマ切り替え
- ✏️ インラインエディタ（Cmd+E）
- ✅ タスクリスト（チェックボックス）対応
- 📥 PDF出力（Cmd+P / CLI convert）
- 🎛️ PDF用CSS・PDF options指定（CLI / Web UI）
- 🎬 動画/音声ストリーミング再生（Range Request対応）
- 📤 ファイルアップロード（ドラッグ&ドロップ）
- 🔒 セキュリティ強化（パストラバーサル防止 + ETag 楽観ロック + CSRF 防御）

## Installation

```bash
# グローバルインストール（推奨）
npm install -g mdv-live

# または npx で直接実行
npx mdv-live
```

## Usage

```bash
# カレントディレクトリを表示
mdv

# 特定のディレクトリを表示
mdv ./docs

# 特定のファイルを開く
mdv README.md

# ポート指定（デフォルト: 8642）
mdv -p 9000

# ブラウザを自動で開かない
mdv --no-browser

# 起動中のサーバー一覧
mdv -l

# サーバーを停止（PID指定）
mdv -k 12345

# 全サーバーを停止
mdv -k -a

# PDFに変換
mdv convert -i report.md -o report.pdf

# PDFに変換（CSSとPDF optionsを指定）
mdv convert \
  -i report.md \
  -o report.pdf \
  -s ./src/styles/report.example.css \
  --pdf-options ./src/styles/report.pdf-options.example.json

# バージョン表示
mdv -v
```

## PDF Export

Markdown ファイルは CLI または Web UI から PDF に変換できます。

### CLI

```bash
mdv convert -i input.md -o output.pdf
```

CSS を指定する場合は `-s` に CSS ファイルパスを渡します。

```bash
mdv convert \
  -i input.md \
  -o output.pdf \
  -s ./src/styles/report.example.css
```

`printBackground` や余白などの PDF 生成オプションは、CSS と分離して JSON ファイルで指定できます。

```bash
mdv convert \
  -i input.md \
  -o output.pdf \
  -s ./src/styles/report.example.css \
  --pdf-options ./src/styles/report.pdf-options.example.json
```

`src/styles/report.example.css` と `src/styles/report.pdf-options.example.json` はサンプルです。必要に応じて任意の CSS / JSON ファイルを指定してください。

### Web UI

ビューア上部の `Style` ボタンを押すとパネルが開き、以下を指定できます。

- **CSS** — サーバー起動時の `rootDir` からの相対パス (例: `report.css`、`subdir/style.css`)
- **PDF options** — `rootDir` からの相対パス (例: `pdf-options.json`)。省略可

`Apply` を押すと CSS は Markdown プレビューにも反映されます。`Clear` で解除。

#### PDF ボタン押下時の挙動 (Markdown ファイル)

| CSS | PDF options | PDF ボタン押下で |
|---|---|---|
| 空 | 空 | OS の **印刷ダイアログ** (`window.print()`) |
| 入れる | 空 | OS の印刷ダイアログ。preview の CSS が styled DOM として print engine に渡る |
| 入れる/空 | **入れる** | サーバー側 `md-to-pdf` で **styled PDF を自動 DL** (`@page` で margin/format を JSON 制御したいときの本格モード) |

`PDF options` を入れない限り印刷ダイアログ経由になるので、ふだんは CSS だけ指定すれば OK。

#### Claude Code との連携

CSS を Claude Code に生成させるとき、**サーバーの `rootDir` 配下** に保存して相対パスを Style パネルに入力してください。例:

```
$ mdv ~/notes        # rootDir = ~/notes
# Claude Code で ~/notes/report.css を生成
# Style パネル CSS 欄に "report.css" を入力 → Apply
```

ファイルが見つからない場合 `Style failed: CSS not found: <path>` がステータスバーに出ます。

### ポート自動増分

ポートが使用中の場合、自動的に次のポート番号を試します。

```
$ mdv -p 8642
ポート 8642 は使用中です。8643 を試します...
MDV server running at http://localhost:8643
```

## macOS Finder Integration

macOSで`.md`ファイルをダブルクリックしてMDVで開けるようにする設定です。

### セットアップスクリプトを使用（推奨）

```bash
# mdvがインストールされていることを確認
which mdv

# セットアップスクリプトを実行
curl -fsSL https://raw.githubusercontent.com/panhouse/mdv-live/main/scripts/setup-macos-app.sh | bash
```

または、リポジトリをクローンしている場合：

```bash
npm run setup-macos
```

### デフォルトアプリに設定

1. Finderで任意の`.md`ファイルを右クリック
2. 「情報を見る」を選択
3. 「このアプリケーションで開く」で「MDV」を選択
4. 「すべてを変更...」をクリック

## Marp Support

`marp: true` フロントマターを含むMarkdownファイルは自動的にMarpスライドとしてレンダリングされます。

```markdown
---
marp: true
theme: default
paginate: true
---

# スライドタイトル

内容...

<!-- スピーカーノート (Presenter View で表示・編集できます) -->

---

# 次のスライド

- 箇条書き
- 数式: $E = mc^2$
```

### サポートされるMarp機能

- **テーマ**: default, gaia, uncover
- **ディレクティブ**: paginate, header, footer, backgroundColor, lang, headingDivider, etc.
- **headingDivider**: scalar (`headingDivider: 2`) / inline-array (`[1, 2]`) / block-array 全形式
- **スライド区切り**: `---` / `***` / `___` (CommonMark thematic break 全形式)
- **画像構文**: `![bg]`, `![w:100px]`, `![bg left]`
- **数式**: KaTeX対応（インライン `$...$`、ブロック `$$...$$`）
- **スピーカーノート**: HTML コメント (`<!-- ... -->`) で記述

## Presenter View

Marp ファイルを開いた状態で **`P` キー** を押すと、別ウィンドウで登壇者ビューが起動します。

### 機能

- **3 ペインレイアウト**: 現在のスライド (大) / 次のスライド (小) / スピーカーノート
- **経過タイマー**: 上部に MM:SS 表示、Reset ボタンで 0 にリセット
- **ノート編集 → 自動保存**: ノートパネルをクリックして編集 → 800ms デバウンスで markdown ソースのコメントを書き戻し
- **キーボードナビ**: ← / → でスライド移動、メイン画面と双方向同期
- **レイアウト調整**: ペイン境界をドラッグで自由に変更、ダブルクリックでデフォルト復元 (localStorage 永続化)
- **Multi-note Guard**: 1 スライドに複数のノートコメントがある場合は自動保存を無効化（先頭ノート消失防止）
- **STALE 検出**: 外部エディタによる変更を ETag 楽観ロックで検出、編集中テキストを localStorage に自動退避

### スピーカーノートの書き方

```markdown
# スライドタイトル

スライドの本文

<!-- ここがスピーカーノート。Presenter View で編集すると
     このコメントが書き換わります。 -->
```

複数行のノートも OK:

```markdown
<!--
- ポイント 1: 〜を強調する
- ポイント 2: ここで質問を投げかける
- 想定時間: 2 分
-->
```

### Presenter View ショートカット

| キー | 動作 |
|---|---|
| `← / →` | スライド移動 |
| `Space / PageDown` | 次のスライド |
| `Home / End` | 最初 / 最後のスライド |

## Keyboard Shortcuts

| ショートカット | 機能 |
|---------------|------|
| Cmd/Ctrl + B | サイドバー表示切替 |
| Cmd/Ctrl + E | 編集モード切替 |
| Cmd/Ctrl + S | 保存（編集モード時） |
| Cmd/Ctrl + P | PDF出力 |
| Cmd/Ctrl + W | タブを閉じる |
| ← / → | スライド移動（Marp時） |
| F | フルスクリーン切替（Marp時） |
| N | ナビバー表示切替（Marp時） |
| **P** | **Presenter View 起動（Marp時）** |
| Esc | フルスクリーン解除 |
| F2 | ファイル名変更 |
| Delete | ファイル削除 |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/file` | GET | ファイル内容取得 (Marp 時は etag/notes/notesMultiplicity も同梱) |
| `/api/file` | POST | ファイル保存 |
| `/api/file` | DELETE | ファイル/ディレクトリ削除 |
| `/api/tree` | GET | ファイルツリー取得 |
| `/api/tree/expand` | GET | ディレクトリ展開（遅延読み込み） |
| `/api/mkdir` | POST | ディレクトリ作成 |
| `/api/move` | POST | ファイル移動/リネーム |
| `/api/download` | GET | ファイルダウンロード |
| `/api/upload` | POST | ファイルアップロード |
| `/api/pdf/export` | POST | PDF出力 |
| `/api/info` | GET | サーバー情報 |
| `/api/marp/decks/:path` | GET | Marp デッキ情報取得 (etag, notes, notesMultiplicity) |
| `/api/marp/decks/:path/slides/:N/note` | PUT | スピーカーノート更新 (`If-Match` 必須、ETag 楽観ロック) |

`/api/marp/decks/*` は Origin / Sec-Fetch-Site / Content-Type を厳密に検証し、cross-origin / cross-site / non-JSON リクエストは `403 ORIGIN_REJECTED` または `415 UNSUPPORTED_MEDIA_TYPE` で拒否します（CSRF / DNS rebinding 防御）。

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript
- **Markdown**: markdown-it + markdown-it-task-lists
- **Marp**: @marp-team/marp-core
- **WebSocket**: ws
- **File Watching**: chokidar
- **Syntax Highlight**: highlight.js

## Development

```bash
# Clone repository
git clone https://github.com/panhouse/mdv-live.git
cd mdv-live

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
mdv/
├── bin/mdv.js                    # CLI entry point
├── src/
│   ├── server.js                 # Express server setup
│   ├── watcher.js                # File watching (chokidar)
│   ├── websocket.js              # WebSocket setup
│   ├── api/
│   │   ├── file.js               # File operations API
│   │   ├── pdf.js                # PDF export API
│   │   ├── tree.js               # File tree API
│   │   ├── upload.js             # Upload API
│   │   ├── marpNote.js           # Marp note autosave routes (orchestration)
│   │   └── marpNote/
│   │       ├── guards.js         # Origin / Host / Content-Type / If-Match guards
│   │       ├── readDeck.js       # Path-safe deck reader (O_NOFOLLOW + realpath)
│   │       ├── handleGet.js      # GET /api/marp/decks/:path
│   │       └── handlePut.js      # PUT /api/marp/decks/:path/slides/:N/note
│   ├── rendering/
│   │   ├── index.js              # Rendering entry
│   │   ├── markdown.js           # Markdown rendering
│   │   ├── marp.js               # Marp rendering (delegates to adapter)
│   │   ├── marpitAdapter.js      # Marpit token adapter (SSOT)
│   │   └── marpNoteWriter.js     # Pure-function note splice
│   ├── concurrency/
│   │   └── pathLock.js           # Promise-chain mutex (per-path serialization)
│   ├── utils/
│   │   ├── errors.js             # Error codes / status mapping (SSOT)
│   │   ├── etag.js               # sha256 ETag (SSOT)
│   │   ├── lineMath.js           # BOM / CRLF / line ↔ byte conversion
│   │   ├── atomicWrite.js        # Atomic file write (O_EXCL + EXDEV fallback)
│   │   ├── fileTypes.js          # File type detection
│   │   └── path.js               # Path security (validatePath / validatePathReal)
│   ├── static/                   # Frontend files
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── presenter.html        # Presenter View (3-pane + autosave)
│   │   ├── styles.css
│   │   └── lib/
│   │       ├── apiClient.js      # HTTP client wrapper
│   │       ├── presenterChannel.js # BroadcastChannel SSOT
│   │       ├── saveQueue.js      # Per-deck save queue + per-slide coalesce
│   │       └── tabRegistry.js    # Tab life-cycle hooks
│   └── styles/
│       ├── index.js
│       ├── report.example.css
│       └── report.pdf-options.example.json
├── scripts/
│   └── setup-macos-app.sh        # macOS app setup
└── tests/                        # Test files (236 件、全 PASS)
```

## Requirements

- Node.js 18+

## Migration from Python version

以前のPython版（`pip install mdv-live`）からの移行：

```bash
# Python版をアンインストール
pip uninstall mdv-live

# Node.js版をインストール
npm install -g mdv-live

# macOSアプリを再設定（必要な場合）
npm run setup-macos
```

## License

MIT
