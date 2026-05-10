# dogfood-ui plan — mdv-live 0.5.17

**対象 URL**: http://localhost:8066
**ベース**: `/Users/okamotohirono/projects/137_識学_ウェビナー/資料`
**実施**: 2026-05-10
**バージョン**: 0.5.17

## 検証項目

### A. 起動・基本ナビゲーション

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| A1 | Marp ファイル open | `/seminar_v2.md` ナビ | split layout (slide / handle / notes) 表示 | |
| A2 | Marp slide 数 == panel 数 | DOM カウント | SVG.length === panel.length | |
| A3 | 通常 md ファイル open | `/seminar.md` ナビ | markdown preview 表示 (split なし) | |
| A4 | Welcome 画面 | `/` ナビ | "Select a file" 表示 | |

### B. Split layout (0.5.16)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| B1 | drag handle 上下移動 | mousedown→move→up | --marp-notes-row 変化 + localStorage 保存 | |
| B2 | drag handle ダブルクリック | dblclick | 240px に reset | |
| B3 | drag 0px (full collapse) | drag最大下 → reload | 0px が永続化される | |
| B4 | viewport より大きい保存値 | 大きい値で localStorage → reload | clamp で SLIDE_ROW_MIN_PX 確保 | |

### C. スライドナビ (0.5.16)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| C1 | Next ボタン | click `.marp-next` | active SVG + active panel が next に | |
| C2 | Prev ボタン | click `.marp-prev` | 戻る | |
| C3 | キー → / Space | keydown | next | |
| C4 | キー ← | keydown | prev | |
| C5 | フルスクリーン F | keydown F | body.marp-fullscreen + notes 非表示 | |
| C6 | フルスクリーン解除 Esc | keydown Esc | 復帰 | |

### D. Inline speaker notes (0.5.16)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| D1 | 編集 → 800ms autosave | input → wait | "保存中…" → "保存済み" | |
| D2 | ファイル書き込み確認 | サーバー file 検査 | marker が反映 | |
| D3 | 多コメントスライド disabled | notesMultiplicity > 1 | editor contenteditable=false + banner | |
| D4 | キー入力中 ←/→ blocked | focus editor → → | スライド遷移しない (stopPropagation) | |

### E. Edit モード autosave (0.5.17)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| E1 | Edit モード入る | click Edit | textarea 表示 + status "Ready" | |
| E2 | input → 1500ms autosave | type → wait | Modified → Saving... → Saved! → Ready | |
| E3 | ファイル書き込み確認 | サーバー file 検査 | marker が反映 | |
| E4 | Cmd+S 即時 flush | type → Cmd+S | debounce 待たず即保存 | |
| E5 | View 切替時 flush | type → Edit click 即 | debounce 中の最後の input も保存 | |
| E6 | タブ切替時 flush + readOnly | type → 別 file open | flush 後保存 + 元 textarea readOnly | |
| E7 | discard-on-close | unsaved → タブ ✕ | 確認ダイアログ + 文言で race window 注記 | |

### F. Presenter view (0.5.16 + origin tag)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| F1 | Presenter view 起動 | P キー | 別 window 開く + slides 表示 | |
| F2 | Presenter から edit-note | presenter で type | inline panel にも反映 | |
| F3 | inline → presenter 同期 | inline で edit | presenter が note 更新 (own-edit でない) | |

### G. 印刷 (0.5.16)

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| G1 | window.print 経由の DOM | console で確認 | @media print で .marp-split → block | |

### H. テーマ

| # | 項目 | 操作 | 期待 | 結果 |
|---|---|---|---|:--:|
| H1 | dark テーマで split layout | theme toggle → screenshot | 配色が正しい | |
| H2 | light テーマ | toggle 戻す | 配色 | |

## 凡例

- ✅ PASS: 操作の保存→反映→再表示までを実機で完走
- ⚠️ PARTIAL: 動くが期待と微妙に違う
- ❌ FAIL: エラー or 期待と違う
- ⏸️ SKIP: 環境的に確認不可
