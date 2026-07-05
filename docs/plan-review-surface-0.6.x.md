# 0.6.x レビューサーフェス計画（2026-07-05 岡本GO）

> 0.6.0 をベースに **0.6.9 までに完成**させる。各バージョンは単体で出荷可能（ゲート: unit + E2E + lint + codex → publish）。
> モック: `../../mock/mdv-review-surface-mock.html`（案件フォルダ側）

## スコープ（岡本の指示で確定）

**mdv はあくまで viewer**。指示は Claude Code に直接出すので、mdv 内のコミュニケーション機能は持たない。

| 機能 | 判定 |
|---|---|
| ① フォルダ横断の全文検索（⌘K パレット） | ✅ やる |
| ② 変更ハイライト（前回確認時からの差分表示・ジャンプ） | ✅ やる（本命） |
| ③ 確認チェック（未読●／✓確認済み・フォルダ未読数） | ✅ やる（軽量に） |
| 差し戻しコメント・レビューコメント | ❌ やらない（指示はCCに直接出す） |
| エージェント依頼バナー・review-request API | ❌ やらない（同上） |
| クラウド/アカウント/ビルドステップ | ❌ 恒久非ゴール |

## 設計判断（先に固定）

### 共通基盤: ソース行マッピング（0.6.1 に含める）
markdown-it の token.map を使い、レンダリング HTML のブロック要素に `data-source-line` を付与する。
**検索の「該当行へジャンプ」と差分ハイライトの両方がこれに乗る**ため最初に作る。
- 対象: 非Marp markdown。code/text ビューは `<pre>` 行単位で対応
- Marp スライドは v1 ではマッピング対象外（変更ありの通知バーのみ）

### ① 全文検索
- API: `GET /api/search?q=&limit=` → `{ results: [{path, line, col, snippet}], truncated, stats }`
  - リテラル検索・smart-case（クエリに大文字があればcase-sensitive）。正規表現は入れない（v1）
  - 対象: fileTypes が markdown/code/text のファイルのみ。ignorePatterns 適用。1ファイル1MB上限、結果500件上限、早期打ち切り
  - ルート: sendError/mkError・constants・既存規約に完全準拠（GET なので originGuard 不要）
- UI: `modules/searchPalette.js`。⌘K/ツールバー検索ボックスで起動、ファイル別グルーピング、↑↓/Enter/Esc、Enter でタブを開き `data-source-line` へスクロール+一瞬ハイライト

### ② 変更ハイライト
- サーバー: `src/services/changeJournal.js` — watcher イベントを購読し、パス毎に**直近数世代の raw スナップショット**を保持（世代=内容hash キー、メモリLRU 総量上限 50MB・1ファイル1MB超は本文保持なし=通知のみ）
- diff: `src/utils/lineDiff.js` — 依存ゼロの Myers 行差分（純関数・ユニットテスト必須）
- API: `GET /api/diff?path=&from=<hash>` → `{ available, added:[[start,end]..], changed:[..], removedAt:[line..] }`。from 世代が無ければ `available:false`（再起動後など。UI は「差分不明」と正直に出す）
- WS: `file_update` に全テキストファイルで content hash を載せる（makeEtag 流用）
- UI: 差分バー（「前回確認 HH:MM から N箇所」・ハイライトON/OFF・⌥↑↓ジャンプ）。追加=緑/変更=黄のブロックハイライト（`data-source-line` 交差判定）。削除は該当位置にマーカーのみ

### ③ 確認チェック
- 状態はクライアント（localStorage）: `{ path: { hash, ts } }`。**リポジトリにファイルを書かない**（viewer-first、.mdv/ ディレクトリ汚染はしない）
- 表示: ツリーに未読●（lastSeen.hash ≠ 現hash）／✓（一致）。フォルダは未読数バッジ。「✓確認済みにする」「フォルダ内すべて確認済み」「次の未読へ」
- 差分の基準（②の from）= lastSeen.hash。✓ を押す = lastSeen を現hash に更新

## リリース列

| ver | 内容 | ゲート | 状態 |
|---|---|---|---|
| 0.6.1 | ソース行マッピング + 検索API + ⌘Kパレット（ジャンプ込み） | unit/E2E/lint/codex → publish | ✅ 出荷済み |
| 0.6.2 | **Excelプレビュー見やすさ改善**（下記・実業務ファイル検品 2026-07-05 で判明） | 同上 + 実機目視 | ✅ 出荷済み |
| 0.6.3 | changeJournal + lineDiff + /api/diff + file_update への hash 追加（バックエンド完結） | 同上 | ✅ 出荷済み |
| 0.6.4 | 差分バー+ハイライト+ジャンプ（フロント） | 同上 + 実機目視 | ✅ 出荷済み |
| 0.6.5 | 未読●/✓チェック・フォルダバッジ・次の未読へ | 同上 + 実機目視 | ✅ 出荷済み |
| 0.6.6 | 統合磨き: 大量フォルダでの性能確認・E2E拡充・README/CHANGELOG・**タイトリストの行マッピング**（議事録の箇条書きが差分ハイライトの主戦場なのに、現状は最寄りブロックへのフォールバック。旧テストの bare-tag 断言を意図をもって更新し li に data-source-line を付与） | 同上 | ✅ 出荷済み |
| 0.6.7-0.6.9 | ドッグフード/codex 指摘・予備枠（Windows対応検討・presenterテスト等の残債は任意） | — | 0.6.7-0.6.8 ✅ 出荷済み／0.6.9 — 未着手・任意（残債は任意） |

> **0.6.8で上書き**: 上記の緑✓（既読マーク一致表示・「✓確認済みにする」文言、③の設計時点の仕様）は 0.6.7 までの仕様。0.6.8 で岡本指示により廃止し、未読は青●の有無のみで判断する方式に変更（緑✓状態そのものを持たない）。詳細は CHANGELOG.md [0.6.8] 参照。

### 0.6.2 Excelプレビュー見やすさ改善（実ファイル検品の結果）

実案件の xlsx 4本（投資対効果試算・機能要件一覧・星取り表・意地悪ケース）で目視検品した結果:

| 問題 | 症状 | 修正 |
|---|---|---|
| P1 日付がシリアル値 | 請求日が「46208」と表示される | xl/styles.xml の numFmt を読み日付書式（builtin 14-22/45-47・カスタム y/m/d）を判定 → YYYY/M/D 表示 |
| P1 数式セルが空欄 | openpyxl 等が生成したファイル（cached <v> なし）で**値の列が丸ごと消える**（投資対効果試算で実発生） | <f> のみのセルは数式文字列を muted 表示（例: =SUM(C2:C3)）。セル存在は列数カウントに含める |
| P2 %書式が生値 | 消化率 0.62 が「0.62」 | numFmt % 判定 → 62% 表示 |
| P2 桁区切りなし | 1485000 | numFmt に桁区切りがあれば 1,485,000 表示（通貨記号までは追わない） |
| P3 末尾空行 | 細い空行が出る | trailing 空行を出力しない |

良かった点（維持）: 整形済みの表（機能要件一覧）はヘッダ・行縞・省略通知まで綺麗。横長は overflow-x スクロールで対応済み。

## 実装規約（リポジトリ CLAUDE.md 準拠 + 追加）

- 新 API ルートは「追加チェックリスト」（docs/ARCHITECTURE.md §4.1）に従う
- フロント新機能は 1機能=1モジュール（modules/searchPalette.js, modules/changeReview.js 等）
- 純ロジック（lineDiff・snippet抽出・smart-case判定）は lib/ or utils/ に置きユニットテスト必須
- 既存挙動を変えない: 検索もチェックも「載せる」だけ。既存 E2E 15本は無修正で green のまま
- パフォーマンス地雷: ツリー再描画は reconcile 済みだが、バッジ更新で全再描画を誘発しないこと（updateHighlight と同様の部分更新で）
