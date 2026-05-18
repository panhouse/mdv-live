# dogfood-ui レポート — 2026-05-18

**対象**: mdv 0.5.20 / Presenter View ノート編集（保存ルーティング）
**サーバ**: `localhost:8064`（`/tmp/mdv-presenter-bug/deck.md` — 157案件の42枚 Marp デッキ）
**手段**: Playwright MCP 実機操作
**所要**: 約 6 分

## 集計

- ✅ PASS: 4 件
- ⚠️ PARTIAL: 0 件
- ❌ FAIL: 0 件
- ⏸️ SKIP: 0 件

## テスト結果

### ✅ T1 — メイン2窓 + Presenter でノート編集（元バグの修正確認）

- 準備: メインウィンドウ A・B の2枚で同じ deck を開き、A から Presenter View を起動
- 操作: Presenter のノート欄に ` 【dogfood-T1】2窓編集テスト` を入力
- 期待: `保存失敗: STALE`（赤）が出ず、`保存済み`（緑）で完了
- 結果: 保存ステータス遷移 `編集中… → 保存中… → 保存済み[OK]` → 自動クリア。**赤エラーなし**
- 証跡: `t1-2windows-saved.png`

### ✅ T2 — PUT が1ウィンドウからのみ発行される

- 操作: T1 の編集時、メイン A・B 双方の `fetch` をフックして note PUT 回数を計測
- 期待: 2窓あっても PUT は1窓のみ（重複 PUT → 楽観ロック衝突 → STALE が起きない）
- 結果: **メイン A = 1回（200）/ メイン B = 0回**。重複 PUT なし

### ✅ T3 — saver ウィンドウ消失時のフェイルオーバー

- 準備: T2 で saver と判明したメイン A を閉じる（メイン B + Presenter が残る）
- 操作: Presenter のノート欄に ` 【dogfood-T3】フェイルオーバー` を入力
- 期待: タイムアウト検知 → `find-saver` で B を発見 → B に再送 → `保存済み`、STALE なし
- 結果: `編集中… → 保存中… → 保存中…（再送）→ 保存済み[OK]`。**メイン B が PUT（200）を発行**。赤エラーなし
- 証跡: `t3-failover-saved.png`

### ✅ T4 — メイン1窓での回帰確認

- 準備: メイン B + Presenter のみ（1窓構成）
- 操作: Presenter のノート欄に ` 【dogfood-T4】1窓回帰` を入力
- 期待: 従来どおりクリーンに保存（フェイルオーバー経由しない）
- 結果: `編集中… → 保存中… → 保存済み[OK]`。回帰なし
- 証跡: `t4-1window-saved.png`

## 保存の実在確認

UI ステータスだけでなく、サーバ側ファイル `/tmp/mdv-presenter-bug/deck.md` に
T1 / T3 / T4 の編集マーカー（`【dogfood-T1】`〜`【dogfood-T4】`）が実際に
書き込まれていることを `grep` で確認。保存は本物（ステータス詐称ではない）。

## 結論

元バグ（メイン複数窓での STALE 毎回発生）は解消。フェイルオーバー・1窓回帰
ともに PASS。FAIL なし。0.5.20 リリース可。
