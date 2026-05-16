# dogfood-ui レポート — 2026-05-16

**対象**: http://localhost:8064 （`/tmp/mdv-dogfood` を root にした mdv-live）
**目的**: Marp `![bg]` 背景画像表示バグ修正の実機検証
**所要**: 約 15 分

## 集計

- ✅ PASS: 6 件
- ⚠️ PARTIAL: 0 件
- ❌ FAIL: 0 件
- ⏸️ SKIP: 0 件

## テスト項目

| # | 項目 | 構文 | 期待 | 判定 | 証跡 |
|---|------|------|------|:--:|------|
| 1 | 全面背景画像 | `![bg](images/cover.png)` | 赤がスライド全面に表示 | ✅ | bg-slide1-full.png |
| 2 | bg fit | `![bg fit](images/cover.png)` | 赤が表示・`background-size:contain` 維持 | ✅ | bg-slide2-fit.png |
| 3 | split 複数 bg | `![bg left]` + `![bg right]` | 青・緑の 2 枚が表示 | ✅ | bg-slide3-split.png |
| 4 | 通常インライン画像（回帰） | `![](images/inline.png)` | 紫が `<img>` で表示 | ✅ | bg-slide4-inline.png |
| 5 | 絶対 URL 背景 | `![bg](https://placehold.co/...)` | URL 素通し・外部画像表示 | ✅ | bg-slide5-url.png |
| 6 | サブディレクトリ解決 | `decks/sub-deck.md` の `![bg](pics/...)` | `/raw/decks/pics/` に解決 | ✅ | bg-subdir.png |

## 検証した経路

- **API**: `/api/file?path=deck.md` → `background-image:url(&quot;/raw/...&quot;)` に書き換え済みを確認
- **静的配信**: `/raw/images/cover.png`・`/raw/decks/pics/sub-cover.png` ともに `200 image/png`
- **実機描画**: ブラウザ（Playwright MCP）で 6 スライドすべて目視。背景画像が実際にレンダリングされることを確認

## コンソール

- エラー 0 件
- 警告 1 件: `cdn.tailwindcss.com should not be used in production`（既存・本件と無関係）

## 結論

修正前は `![bg]` を含むスライドがすべて空白だった（157_イディアコーポレーション案件で発覚）。
`rewriteMediaPaths` に `background-image:url(...)` 書き換えルールを追加した結果、
相対パス・サブディレクトリ・複数 bg・split・fit のすべてで背景画像が表示されることを実機確認した。
絶対 URL とインライン画像に回帰なし。
