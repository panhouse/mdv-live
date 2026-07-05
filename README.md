# MDV - Markdown Viewer with Marp Support

ファイルツリー + ライブプレビュー + Marp完全対応のMarkdownビューア

[![npm version](https://badge.fury.io/js/mdv-live.svg)](https://www.npmjs.com/package/mdv-live)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 📁 左側にフォルダツリー表示（遅延読み込み対応）
- 📄 Markdownをリアルタイムレンダリング
- 🎬 **Marp完全対応**（公式テーマ・ディレクティブ・数式）
- 🎤 **Presenter View**（スピーカーノート別ウィンドウ・自動保存・タイマー） — `P` キーで起動
- 🪟 **PowerPoint 風 Split Layout** — 上にスライド / 下にスピーカーノート、間にドラッグハンドルでサイズ変更（0.5.16+）
- 📝 **Inline Speaker Notes Editor** — メイン画面で直接ノート編集 → 800ms デバウンスで自動保存（0.5.16+）
- 🔄 ファイル更新時に自動リロード（WebSocket）
- 🎨 シンタックスハイライト（highlight.js）
- 📊 Mermaid図のレンダリング
- 🌙 ダーク/ライトテーマ切り替え
- ✏️ **インラインエディタ + 自動保存** — `Cmd+E` で編集モード、入力 → 1500ms で自動保存（0.5.17+）
- ✅ タスクリスト（チェックボックス）対応
- 📥 PDF出力（Cmd+P / CLI convert）
- 🎛️ PDF用CSS・PDF options指定（CLI / Web UI）
- 🎬 動画/音声ストリーミング再生（Range Request対応・非対応コーデックは案内+ダウンロードにフォールバック）
- 📊 **Office 雰囲気プレビュー** — `.xlsx`/`.pptx`/`.docx` の中身をレイアウト再現なしで素早く確認（0.6.0+）
- 📤 ファイルアップロード（ドラッグ&ドロップ）
- 🔒 セキュリティ強化（パストラバーサル防止 + ETag 楽観ロック + CSRF 防御）

## AIエージェント時代の検収ビュー

MDV はビューアですが、0.6.x 系では「**AIエージェント（Claude Code 等）が
書いた成果物を、人間が確認する画面**」としての使い方を軸に機能を重点強化
しています。指示は引き続き Claude Code 側に直接出す前提（レビューコメント
や通知機能は持ちません）で、「何が変わったか」を素早く把握し「見た/OK」を
記録することに絞っています。

- 🔍 **⌘K / Ctrl+K 全文検索**（0.6.1〜） — フォルダ横断で markdown/コード/
  テキストをリテラル検索。ファイル別グルーピング、Enter で該当ファイルを
  開いて該当行へスクロール+フラッシュ表示。
- 📊 **Excel/Office プレビューの実務対応**（0.6.2〜） — 日付書式・数式セル・
  %・桁区切りを正しく表示（詳細は後述の「Office 雰囲気プレビュー」）。
- 🟡 **変更ハイライト**（0.6.3〜0.6.4） — 前回確認時からの差分を検出し、
  タブ下に「前回確認 HH:MM から N箇所変更されました」バーを表示。追加行は
  緑・変更行は黄でブロックハイライト、`⌥↑↓` で変更箇所へジャンプ、「最新を
  確認済みにする」で基準を更新（0.6.6 で箇条書き1行にも直接ハイライトが
  乗るように改善 — 議事録の決定事項が変わったとき、見出しではなくその
  箇条書き自体が光ります）。
- ✅ **未読●/✓ ツリーバッジ**（0.6.5〜） — 外部で変更/新規作成されたファイル
  に未読●、確認済みに緑✓。フォルダ行に未読数バッジ、サイドバーヘッダに
  合計チップ、チップクリック / `⌥⇧↓` で「次の未読へ」ジャンプ。

「前回確認した内容」の基準はブラウザの localStorage に保存され（サーバーや
リポジトリには何も書き込みません）、配信ルート（プロジェクト）ごとに
分離されます。

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

> **依存パッケージは optional 扱い** — `@marp-team/marp-cli` (Marp 用) と `md-to-pdf` (Plain Markdown 用) は `optionalDependencies`。デフォルト `npm install` でも入りますが、CI 等で `--omit=optional` 指定すると入りません。**PDF 機能を使うなら**:
> ```bash
> npm install -g mdv-live  # 通常はこれで OK (optional も入る)
> # CI などで --omit=optional する場合:
> npm install --include=optional
> ```
> 不在のまま PDF 生成すると、サーバーは 503 + 案内、CLI は exit 1 + `npm install --include=optional` 提案を返します。

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

## Office 雰囲気プレビュー & 動画フォールバック

- **Office 雰囲気プレビュー**: `.xlsx` / `.pptx` / `.docx`（20MB以下）を開くと、レイアウトそのままの完全再現ではなく「中身の雰囲気」だけを素早く確認できるプレビューを表示します（xlsx = 先頭シートの表、pptx = スライドごとのタイトル+箇条書き、docx = 段落の羅列）。行・列・スライド・段落が多い場合は自動的に先頭のみ表示し、省略した旨を通知します。常にダウンロードリンクを表示するので、正確なレイアウトは元アプリ（Excel/PowerPoint/Word）で確認してください。20MB超のファイルや破損ファイル、旧形式（`.doc`/`.xls`/`.ppt`）は従来通りダウンロードカードのみの表示です。
- **動画フォールバック**: MPEG-4 Part 2 や HEVC など、ブラウザが再生できない形式の動画ファイルを開くと、これまでは真っ黒な再生不可プレイヤーが表示されるだけでしたが、「この動画はブラウザで再生できない形式です」という案内とダウンロードボタンに自動的に切り替わります。QuickTime 等の外部プレイヤーでご覧ください。再生可能な動画（h264 等）の挙動は変わりません。

## Config File (mdv.config.json)

サーブ対象のディレクトリ（`mdv convert` の場合はカレントディレクトリ）に
`mdv.config.json` を置くと、毎回 CLI 引数を打たなくてもデフォルト値を
プロジェクトごとに固定できます。

```json
{
  "port": 3000,
  "depth": 5,
  "open": false,
  "css": "./styles/report.css",
  "pdfOptions": "./styles/report.pdf-options.json"
}
```

| キー | 型 | 効くところ |
|---|---|---|
| `port` | number | ビューワ（`-p, --port` 相当） |
| `depth` | number | ビューワ（`-d, --depth` 相当） |
| `open` | boolean | ビューワ（`--no-browser` の逆） |
| `css` | string（`mdv.config.json` からの相対パス） | `mdv convert` の `-s` 相当 **+ ビューワの Style パネル初期値** |
| `pdfOptions` | string（同上） | `mdv convert` の `--pdf-options` 相当 **+ ビューワの Style パネル初期値** |

`css` / `pdfOptions` はビューワ起動時に Style パネルへ自動で入るので、
プロジェクトごとの PDF スタイルが「開いただけで」適用されます。パネルで
手動設定した値（ブラウザに記憶）が常に優先されます。

**優先順位: CLI 引数 > `mdv.config.json` > 組み込みデフォルト**。未知のキーは
警告を出して無視されます（エラーにはなりません）。

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

## Inline Speaker Notes (PowerPoint-style Split Layout)

Marp ファイルを開くとメイン画面が **上下 2 ペイン** に分かれます。上がスライド、下がスピーカーノートエディタ、間に **ドラッグ可能な仕切り**。Presenter View を別ウィンドウで開かなくても、その場でノート編集できます。

### 使い方

- **仕切りをドラッグ**: スライド / ノートの比率を変更
- **仕切りをダブルクリック**: 240px (デフォルト) にリセット
- **完全に閉じる**: 仕切りを画面下まで → ノート 0px (リロードしても復元)
- **ノートをクリックして入力**: 800ms デバウンスで自動保存。マークダウンソースの `<!-- ... -->` コメントが書き換わります
- **保存ステータス**: 編集中… / 保存中… / 保存済み / 失敗 (パネル右上に表示)
- **スライド切替で連動**: ナビ ←/→ または `Space` で active スライドが切り替わるとノートも対応スライドのものに

### Presenter View との関係

別ウィンドウの Presenter View (`P` キー) と **同じノートを共有**します。両方同時に開いて編集することも可能ですが、ETag 楽観ロックで **STALE 検出** されます (片方が STALE になったら後勝ちで上書きせず、ローカルストレージに退避)。

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

## Editor (Edit モード)

`Cmd+E` で **編集モード** に入ると textarea が開きます。**入力 → 1500ms で自動保存**するので、`Cmd+S` を押し忘れて変更が消える心配はありません。

### 自動保存の挙動

- **入力 → 1500ms debounce → POST `/api/file`** → ステータスバー: `Modified → Saving... → Saved! → Ready`
- **`Cmd+S`** は引き続き使えます。押すと **debounce を待たず即時 flush**
- **View 切替 / タブ切替 / 別ファイル open** 時に **flush + await** — 保存完了するまで遷移しません
- **保存失敗時** (ネットワーク断など) はエディタを閉じず Edit モードに留まります。`Error: ...` が表示されたらリトライしてください
- **Discard-on-close** (✕ で未保存タブを閉じる): 確認ダイアログが出ます。サーバーが既にリクエストを受信した直後の race window では、その時点までの内容がファイルに残る可能性があります（ダイアログに注記あり）

## Keyboard Shortcuts

| ショートカット | 機能 |
|---------------|------|
| Cmd/Ctrl + B | サイドバー表示切替 |
| Cmd/Ctrl + E | 編集モード切替 (open: textarea / close: flush + 再 fetch + render) |
| Cmd/Ctrl + S | **保存を即時 flush** (編集モード時。autosave debounce 中なら待たずに POST) |
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

# Run unit/integration tests (must be all-PASS)
npm test

# Run Playwright E2E smoke suite (must be all-PASS)
npm run test:e2e

# Lint (must be clean)
npm run lint
```

## Project Structure

```
mdv/
├── bin/mdv.js                    # Thin CLI entry point (parses argv, exits)
├── src/
│   ├── cli/                      # CLI subcommand logic (unit-testable)
│   │   ├── registry.js           # Subcommand table + dispatch
│   │   ├── config.js             # mdv.config.json loader
│   │   ├── convert.js            # `mdv convert` subcommand
│   │   ├── resolveTarget.js      # Positional path → { rootDir, initialFile }
│   │   └── serverRegistry.js     # `mdv -l` / `mdv -k`
│   ├── config/
│   │   └── constants.js          # Cross-module constants (port, depth, caps)
│   ├── server.js                 # Express server setup
│   ├── watcher.js                # File watching (chokidar)
│   ├── websocket.js              # WebSocket setup
│   ├── api/
│   │   ├── file.js               # File operations API
│   │   ├── pdf.js                # PDF export API
│   │   ├── tree.js               # File tree API
│   │   ├── upload.js             # Upload API
│   │   ├── marpNote.js           # Marp note autosave routes (orchestration)
│   │   ├── marpNote/
│   │   │   ├── guards.js         # Content-Type / If-Match / note guards
│   │   │   ├── readDeck.js       # Path-safe deck reader (realpath)
│   │   │   ├── handleGet.js      # GET /api/marp/decks/:path
│   │   │   └── handlePut.js      # PUT /api/marp/decks/:path/slides/:N/note
│   │   └── middleware/
│   │       └── originGuard.js    # Origin / Host (CSRF) guard — SSOT
│   ├── rendering/
│   │   ├── index.js              # Rendering entry
│   │   ├── markdown.js           # Markdown rendering
│   │   ├── marp.js               # Marp rendering (delegates to adapter)
│   │   ├── marpitAdapter.js      # Marpit token adapter (SSOT)
│   │   └── marpNoteWriter.js     # Pure-function note splice
│   ├── services/
│   │   └── pdf.js                # PDF generation, shared by API + CLI
│   ├── concurrency/
│   │   └── pathLock.js           # Promise-chain mutex (per-path serialization)
│   ├── utils/
│   │   ├── errors.js             # Error codes / status mapping (SSOT)
│   │   ├── etag.js               # sha256 ETag (SSOT)
│   │   ├── html.js               # HTML escaping (SSOT)
│   │   ├── ignorePatterns.js     # Ignored files/dirs (tree + watcher, SSOT)
│   │   ├── lineMath.js           # BOM / CRLF / line ↔ byte conversion
│   │   ├── atomicWrite.js        # Atomic file write (O_EXCL + EXDEV fallback)
│   │   ├── fileTypes.js          # File type detection
│   │   ├── version.js            # package.json version reader
│   │   └── path.js               # Path security (validatePath / validatePathReal)
│   ├── static/                   # Frontend — zero-build, native ES modules
│   │   ├── index.html
│   │   ├── app.js                # Bootstrap entry (imports + init())
│   │   ├── presenter.html        # Presenter View (3-pane + autosave)
│   │   ├── styles.css
│   │   ├── modules/              # One manager per module (~25 files)
│   │   ├── lib/
│   │   │   ├── apiClient.js      # HTTP client wrapper
│   │   │   ├── presenterChannel.js # BroadcastChannel SSOT
│   │   │   ├── saveQueue.js      # Per-deck save queue + per-slide coalesce
│   │   │   ├── tabRegistry.js    # Tab life-cycle hooks
│   │   │   ├── errorCodes.js     # Error code names (mirrors utils/errors.js)
│   │   │   ├── debounce.js       # Debounced-action factory
│   │   │   ├── marpZoom.js       # Pure zoom math (DOM-free)
│   │   │   └── notesEditor.js    # Shared speaker-notes editor helpers
│   │   └── vendor/               # Offline-vendored highlight.js/mermaid/
│   │                              #   tailwind/html2pdf + versions.json
│   │                              #   (tracked by scripts/sync-vendor.js)
│   └── styles/
│       ├── index.js
│       ├── report.example.css
│       └── report.pdf-options.example.json
├── scripts/
│   ├── setup-macos-app.sh        # macOS app setup
│   └── sync-vendor.js            # Re-populates src/static/vendor/
└── tests/
    ├── *.js                      # Unit/integration tests (node --test)
    └── e2e/                      # Playwright E2E smoke suite
```

See `docs/ARCHITECTURE.md` for the full module inventory and request/data-flow
maps, and `CLAUDE.md` for the coding conventions.

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
