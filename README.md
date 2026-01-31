# MDV - Markdown Viewer with Marp Support

ファイルツリー + ライブプレビュー + Marp完全対応のMarkdownビューア

## Features

- 📁 左側にフォルダツリー表示（遅延読み込み対応）
- 📄 Markdownをリアルタイムレンダリング
- 🎬 **Marp完全対応**（公式テーマ・ディレクティブ・数式）
- 🔄 ファイル更新時に自動リロード（WebSocket）
- 🎨 シンタックスハイライト（highlight.js）
- 📊 Mermaid図のレンダリング
- 🌙 ダーク/ライトテーマ切り替え
- ✏️ インラインエディタ（Cmd+E）
- ✅ タスクリスト（チェックボックス）対応
- 📥 PDF出力（Cmd+P）
- 🎬 動画/音声ストリーミング再生（Range Request対応）
- 📤 ファイルアップロード（ドラッグ&ドロップ）
- 🔒 セキュリティ強化（パストラバーサル防止）

## Installation

```bash
# ローカルインストール
npm install

# グローバルコマンドとして登録
npm link
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
mdv --pdf slide.md
mdv --pdf slide.md -o output.pdf

# バージョン表示
mdv -v
```

### ポート自動増分

ポートが使用中の場合、自動的に次のポート番号を試します。

```
$ mdv -p 8642
ポート 8642 は使用中です。8643 を試します...
MDV server running at http://localhost:8643
```

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
│   │   ├── tree.js      # File tree API
│   │   └── upload.js    # Upload API
│   ├── rendering/
│   │   ├── index.js     # Rendering entry
│   │   ├── markdown.js  # Markdown rendering
│   │   └── marp.js      # Marp rendering
│   ├── utils/
│   │   ├── fileTypes.js # File type detection
│   │   └── path.js      # Path security utilities
│   └── static/          # Frontend files
│       ├── index.html
│       ├── app.js
│       └── styles.css
└── tests/               # Test files
```

## Requirements

- Node.js 18+

## License

MIT
