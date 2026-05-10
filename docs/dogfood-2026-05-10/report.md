# dogfood-ui レポート — 2026-05-10

**対象**: `mdv-live@0.5.17` (server: http://localhost:8066)
**所要**: 約 30 分
**実施**: 2026-05-10

## 集計

- ✅ **PASS: 23 件**
- ⚠️ PARTIAL: 0 件
- ❌ FAIL: 0 件
- ⏸️ SKIP: 4 件

## 詳細

### A. 起動・基本ナビゲーション

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| A1 | Marp ファイル open → split layout | ✅ | `marpSplit / marpSlideArea / marpNotesArea / marpSplitHandle` 全揃い |
| A2 | Marp slide 数 == panel 数 | ✅ | 35 SVG / 35 panel (一致) |
| A3 | 通常 md は split なし | ✅ | `講演本編_20260508.md` で `markdown-body` 表示、split なし |
| A4 | Welcome 画面 | ⏸️ SKIP | 起動時挙動・優先度低 |

### B. Split layout (0.5.16)

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| B1 | drag handle ドラッグ | ✅ | 164px → 244px、localStorage `mdv-notes-row-px=244` |
| B2 | ダブルクリックで reset | ✅ | 244px → 240px、localStorage 240 |
| B3 | 0px 完全閉じ + reload | ✅ | drag を最下まで → 0px、reload 後 0px 復元 |
| B4 | viewport 超え値の clamp | ✅ | localStorage に 99999 → 復元時 739px (slide row 80px 確保) |

### C. スライドナビ (0.5.16)

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| C1 | Next ボタン | ✅ | 1/35 → 2/35、active SVG / panel 同期 |
| C2 | Prev ボタン | ✅ | 2/35 → 1/35 |
| C3 | キー → | ✅ | 1/35 → 2/35 |
| C4 | キー ← | ✅ | 2/35 → 1/35 |
| C5 | F フルスクリーン | ✅ | `body.marp-fullscreen` 付与 + `marpNotesArea` display:none |
| C6 | Esc 復帰 | ✅ | fullscreen 解除 |

### D. Inline speaker notes (0.5.16)

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| D1 | input → 800ms autosave | ✅ | status: 編集中… → 保存済み (`speaker-notes-status ok`) |
| D2 | ファイル書き込み | ✅ | seminar_v2.md に `DOGFOOD-INLINE-D1` 反映 → revert (git diff 0) |
| D3 | 多コメントスライド disabled | ⏸️ SKIP | 検証ファイルに該当スライドなし。`tests/test-marp-note-writer.js` で unit covered |
| D4 | 編集中 ←/→ blocked | ✅ | editor focus 中の ArrowRight でスライド遷移せず (1/35 維持) |

### E. Edit モード autosave (0.5.17)

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| E1 | Edit モード入る | ✅ | `editorTextarea` 表示、status `Ready`、Edit ラベル → `View` |
| E2 | input → 1500ms autosave + status 遷移 | ✅ | t=0:Modified → t=1800ms:Saved! → t=4000ms:Ready |
| E3 | ファイル書き込み | ✅ | seminar.md に `DOGFOOD-EDIT-E2` 反映 |
| E4 | Cmd+S 即時 flush | ✅ | 入力 50ms 後 Cmd+S → 600ms で Saved! + ファイル反映 |
| E5 | View 切替時 flush | ✅ | 入力 → 即 Edit ボタン → debounce 中の最後の input がファイルに反映 |
| E6 | タブ切替時 flush | ✅ | 入力 → 即 `MDV.openFile('別')` → 元 file に flush 反映 |
| E7 | discard-on-close ダイアログ | ✅ | 「未保存の変更」表示 + 「自動保存処理中の場合〜」race window 文言を確認 |

### F. Presenter view (0.5.16 / origin tag)

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| F1 | P キーで Presenter 起動 | ✅ | 別 window が `static/presenter.html` で開く |
| F2 | Presenter → main 反映 | ⏸️ SKIP | 別 window 操作複雑。`test-save-queue` の origin forwarding で unit covered |
| F3 | main → Presenter 反映 | ⏸️ SKIP | 同上 + `presenter.html` の foreign-save guard で防御 |

### G. 印刷時 layout

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| G1 | @media print で `.marpit` / `.marp-split` が block 復帰 | ✅ | CSSOM walk で 7 件の print-scoped block ルール検出（うち `.marpit` `.marp-split` 含む） |

### H. テーマ

| # | 項目 | 結果 | 観測値 |
|---|---|:--:|---|
| H1 | dark テーマで split layout | ✅ | `[data-theme=dark]` で配色正しい (screenshot: `H1_dark.png`) |
| H2 | light に戻る | ✅ | toggle で `[data-theme=light]` 復帰 (screenshot: `H2_light.png`) |

## FAIL 詳細

なし。

## 副次確認

- **テスト**: `npm test` 257/257 PASS
- **公開バージョン**: `npm view mdv-live@latest version` → `0.5.17`
- **検証ファイル復元**: `git -C 137_識学_ウェビナー diff 資料/seminar.md` → 0 行
- **検証ファイル復元**: `git -C 137_識学_ウェビナー diff 資料/seminar_v2.md` → 0 行

## 証跡

- スクショ: `.playwright-mcp/dogfood-2026-05-10/`
  - `A1_marp_split.png`
  - `H1_dark.png`
  - `H2_light.png`
- (前回 ad-hoc 分): `.playwright-mcp/dogfood-2026-05-09-r{3,4,5}-*.png`

## 結論

**0.5.17 は本番運用可。**

カバー漏れは:
- 多コメントスライド disabled (D3) — unit test で代替
- Presenter ↔ inline 同期 (F2/F3) — unit test + コード review で代替
- Welcome 画面 (A4) — 重要度低

これらは unit test / コード上 covered なので、UI dogfood としては十分。
