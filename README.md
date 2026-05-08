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

ビューア上部の `Style` から以下を指定できます。

- CSS ファイルパス
- PDF options JSON ファイルパス

CSS は Markdown プレビューにも反映されます。指定を解除する場合は `Clear` を押してください。

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

---

# 次のスライド

- 箇条書き
- 数式: $E = mc^2$
```

### サポートされるMarp機能

- **テーマ**: default, gaia, uncover
- **ディレクティブ**: paginate, header, footer, backgroundColor, etc.
- **画像構文**: `![bg]`, `![w:100px]`, `![bg left]`
- **数式**: KaTeX対応（インライン `$...$`、ブロック `$$...$$`）

## Keyboard Shortcuts

| ショートカット | 機能 |
|---------------|------|
| Cmd/Ctrl + B | サイドバー表示切替 |
| Cmd/Ctrl + E | 編集モード切替 |
| Cmd/Ctrl + S | 保存（編集モード時） |
| Cmd/Ctrl + P | PDF出力 |
| Cmd/Ctrl + W | タブを閉じる |
| ← / → | スライド移動（Marp時） |
| F2 | ファイル名変更 |
| Delete | ファイル削除 |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/file` | GET | ファイル内容取得 |
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
├── bin/mdv.js           # CLI entry point
├── src/
│   ├── server.js        # Express server setup
│   ├── watcher.js       # File watching (chokidar)
│   ├── api/
│   │   ├── file.js      # File operations API
│   │   ├── pdf.js       # PDF export API
│   │   ├── tree.js      # File tree API
│   │   └── upload.js    # Upload API
│   ├── rendering/
│   │   ├── index.js     # Rendering entry
│   │   ├── markdown.js  # Markdown rendering
│   │   └── marp.js      # Marp rendering
│   ├── utils/
│   │   ├── fileTypes.js # File type detection
│   │   └── path.js      # Path security utilities
│   ├── static/          # Frontend files
│       ├── index.html
│       ├── app.js
│       └── styles.css
│   └── styles/
│       ├── index.js
│       ├── report.example.css
│       └── report.pdf-options.example.json
├── scripts/
│   └── setup-macos-app.sh  # macOS app setup
└── tests/               # Test files
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
