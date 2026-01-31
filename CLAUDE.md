# MDV - Claude Code Instructions

## Overview

MDV (Markdown Viewer) は Node.js + Express で構築されたMarkdownビューアです。
ファイルツリー表示、ライブプレビュー、Marp スライド対応を提供します。

## Quick Commands

```bash
npm install          # 依存関係インストール
npm test             # テスト実行（76テスト）
npm run dev          # 開発サーバー起動
npm link             # グローバルコマンド登録
```

## Architecture

```
bin/mdv.js           # CLI エントリーポイント
src/
├── server.js        # Express サーバー + WebSocket
├── watcher.js       # chokidar ファイル監視
├── api/
│   ├── file.js      # ファイル操作 API（CRUD）
│   ├── tree.js      # ファイルツリー API
│   └── upload.js    # アップロード API（multer）
├── rendering/
│   ├── index.js     # レンダリング統合
│   ├── markdown.js  # markdown-it レンダリング
│   └── marp.js      # marp-core レンダリング
├── utils/
│   ├── fileTypes.js # ファイルタイプ判定
│   └── path.js      # パスセキュリティ（validatePath）
└── static/          # フロントエンド（Vanilla JS）
```

## Key Files

| ファイル | 役割 |
|----------|------|
| `src/utils/path.js` | セキュリティ検証（パストラバーサル防止） |
| `src/api/file.js` | 全ファイル操作 + Range Request |
| `src/rendering/markdown.js` | Marp検出 + Markdown変換 |
| `bin/mdv.js` | CLI引数パース + サーバー起動 |

## Security

`validatePath()` で以下を検証:
- 絶対パス拒否（`/etc/passwd`）
- パストラバーサル拒否（`../`）
- null byte拒否（`%00`）
- rootDir 外アクセス拒否

## Testing

```bash
npm test  # 76テスト全てPASS必須
```

テストファイル:
- `test-cli.js` - CLIオプション
- `test-server.js` - APIエンドポイント
- `test-security.js` - セキュリティ検証
- `test-file-operations.js` - ファイル操作
- `test-markdown-rendering.js` - Markdownレンダリング
- `test-marp-detection.js` - Marp検出
- `test-download.js` - ダウンロード

## Coding Rules

- ES Modules（`import/export`）
- 非同期は `async/await`
- エラーは適切にハンドリング（握りつぶさない）
- セキュリティ変更時は必ずテスト追加

## Port Assignment

デフォルト: `8642`
使用中の場合は自動で `+1` して空きポートを探索

## Dependencies

主要パッケージ:
- `express` - HTTPサーバー
- `ws` - WebSocket
- `chokidar` - ファイル監視
- `markdown-it` - Markdown変換
- `@marp-team/marp-core` - Marpスライド変換
- `multer` - ファイルアップロード
- `mime-types` - MIMEタイプ判定
