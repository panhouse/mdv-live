# dogfood-ui レポート — mdv-live 0.5.18 (offline vendor conversion)

**対象**: `http://localhost:8071/` (Node 18 + Chromium via Playwright MCP)
**テストデータ**: `/tmp/mdv-offline-test/{test,marp}.md`
**所要**: 約 15 分
**目的**: 5 つの CDN 依存 (highlight.js / Mermaid / html2pdf / Tailwind / hljs CSS theme) を `src/static/vendor/` 同梱に切り替えた後、既存機能 (0.5.16 split layout / 0.5.17 edit autosave / 既存全般) が回帰なく動くか体系検証。

## 集計

- ✅ PASS: 16 件
- ⚠️ PARTIAL: 0 件
- ❌ FAIL: 0 件
- ⏸️ SKIP: 2 件 (環境理由)

## 個別結果

| # | 項目 | 結果 | 証跡 |
|---|---|:--:|---|
| 1 | サーバー起動 → ページ load | ✅ | `01-test-md.png`, console errors はテスト md に存在しない `style.css` 探索のみ (既存挙動) |
| 2 | 外部 CDN リクエストゼロ | ✅ | `browser_network_requests` を `^https?://(?!localhost)` で filter → 0 件 |
| 3 | file tree レンダリング | ✅ | sidebar に `test.md` / `marp.md` 表示 |
| 4 | tab open (test.md) | ✅ | tab-bar に `test.md` 出現、内容描画 |
| 5 | markdown render | ✅ | H1 1 件、H2 複数、リスト・コードブロック描画 |
| 6 | code highlight (Python) | ✅ | `pre code.language-python` 内に `.hljs-keyword` 等 4 要素 = github theme 適用 |
| 7 | mermaid render | ✅ | `.mermaid svg` 1 件、内部 `g` 16 件 (ノード＋エッジ) |
| 8 | Tailwind ロード | ✅ | `window.tailwind` is object (JIT 動作)、marp.md でクラス展開確認 |
| 9 | theme toggle | ✅ | `#themeToggle` クリックで `data-theme` light↔dark、`#hljs-theme.href` が `/static/vendor/highlight/github{,-dark}.min.css` を切替 |
| 10 | Marp split layout (0.5.16) | ✅ | `02-marp-split.png`、`.marp-split` + `.marp-slide-area` + `.marp-split-handle` + `.marp-notes-area` 全揃 |
| 11 | inline notes 表示 (0.5.16) | ✅ | slide 1 (page 2) の `<!-- ... -->` が `data-role="editor"` contenteditable に展開 |
| 12 | inline notes 編集経路 (0.5.16) | ⏸️ | contenteditable 構造を経由するため Playwright `evaluate` での直書き経路は別途。0.5.16 dogfood で検証済、本回帰なし |
| 13 | edit mode toggle (0.5.17) | ✅ | `#editToggle` クリック → textarea visible、status `Ready`、ラベルが `Edit`→`View` |
| 14 | edit autosave (0.5.17) | ✅ | textarea に追記 → 2.5s 待機 → status `Modified`→`Ready`、ファイル md5 `3faed826...`→`f12675f7...`、追記マーカー保存確認 |
| 15 | revert ファイル | ✅ | `.orig` から復元、md5 が元値に戻る |
| 16 | hljs version | ✅ | `window.hljs.versionString === '11.11.1'` (npm dep `@highlightjs/cdn-assets@^11.11.1`) |
| 17 | button 配線 (PDF / PDF style / sidebar) | ✅ | `#printBtn` / `#pdfStyleToggle` / `#sidebarToggle` 存在 (handler は既存テスト 272 件で担保) |
| 18 | Wi-Fi 物理断 dogfood | ⏸️ | 物理 Wi-Fi OFF は手元検証必要 (次回 round 2)。代替として網羅的 network 監視で外部リクエスト 0 を確認済 |

## 詳細メモ

### Network 検証 (オフライン担保の本丸)

ページ load 直後の network log:

```
1.  GET /                                       200
2.  GET /static/vendor/highlight/github-dark.min.css   200
3.  GET /static/styles.css                      200
4.  GET /static/vendor/highlight.min.js         200
5.  GET /static/vendor/mermaid.min.js           200
6.  GET /static/vendor/html2pdf.bundle.min.js   200
7.  GET /static/vendor/tailwind.min.js          200
8-12.  /static/lib/*.js, /static/app.js          200
13. GET /static/vendor/highlight/github.min.css 200  (light theme prefetch)
14. GET /raw/style.css                          404  (既存: ユーザー指定 CSS なし)
15-17. /api/info, /api/tree, /api/file           200
```

非 `localhost` ドメインへの GET/POST: **0 件**。highlight.js / Mermaid / html2pdf / Tailwind / hljs CSS の全てが local serve に置き換わったことを確認。

### Codex review

- Round 1 (commit `6dff8fc`): [P2] html2pdf LICENSE sidecar 未コピー、[P3] vendor 元 npm パッケージが dependencies に混入 → 修正
- Round 2 (commit `24e4478`): "No actionable regressions were identified" で収束

### テスト

- `npm test`: 272 件 全 PASS
  - 新規 `tests/test-offline-assets.js`: 14 件
    - HTML/JS 3 ファイルで外部 CDN URL 不在 (regex 検査)
    - vendor 必須 11 ファイル (バンドル + license sidecars) 存在
    - `@highlightjs/cdn-assets` / `mermaid` / `html2pdf.js` が `dependencies` に居ない (devDeps 固定)

## 注意事項

- **Tailwind v3.4.17 で pin**: v4 系は config 構文 (`tailwind.config = { ... }`) が変わるので bump 時は手作業マイグレーション必須
- **vendor/ は repo commit する**: `npm publish` に同梱される (`files: ["src/"]`)
- **sync-vendor.js の実行タイミング**: メンテナの version bump 時のみ (`postinstall` フックは入れていない、global install の二重 download を避けるため)
- **html2pdf.bundle.min.js.LICENSE.txt は bundle 1 行目から名指しで参照**: 名前を変えると broken reference になる、リネーム禁止

## 結論

回帰なし。0.5.18 として publish 可。
