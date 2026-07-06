# mdv-live リファクタリング戦略 2026-07

> 目的: **売り物（プロダクト）として機能追加しやすいコードベースにする**。
> 原則: DRY / SOLID / SSOT。8視点並列監査（2026-07-05、8エージェント・全コード実読）の結果に基づく。
> 本ドキュメントがこのリファクタリングの SSOT。旧 REFACTOR-PLAN.md（2026-05、実施済み）は docs/archive/ へ。

## 0. 診断サマリー

> **状態（0.6.12時点、2026-07-06更新）**: この診断は 2026-07-05 のスナップショット。P1-1(CSRF)・
> P1-2(無視リスト乖離)・P1-3(非アトミック保存)・P1-4(errors.js SSOT 未採用)・
> P1-10(multer 1.x) は 0.6.0 で修正済み（詳細は CHANGELOG.md [0.6.0] 参照）。
> P1-5(escapeHtml 3実装)・P1-6(readEditableText 重複)・P1-7(presenter 保存
> ルーティング状態機械が未テスト) も解消済み（`src/utils/html.js`・
> `src/static/lib/notesEditor.js`・`src/static/lib/saveQueue.js` に統合、
> いずれもテスト付き）。P1-8(bin/mdv.js) は `src/cli/` への分割で、P1-9
> (app.js) は `src/static/modules/` への分割で解消済み。P1-11(テスト数の
> ハードコード) は CLAUDE.md/README とも「all-PASS」表記に是正済み。§4
> 成功基準は個別に再検証が必要（app.js は388行、modules/diffReview.js は
> 896行（0.6.9-0.6.12でReview mode統合に伴い677→896行へさらに乖離）・
> contentRenderer.js は515行で未達 — 0.6.x でレビューサーフェス機能を
> 追加した影響）。

コードベースは「**不均一にリファクタ済み**」。2026-05 のリファクタで作られた SSOT 基盤
（utils/errors.js, etag.js, atomicWrite.js, pathLock.js, marpNote/ の guard 分離）は本物だが、
**採用が marpNote サブシステムで止まっている**。古い api/file.js・tree.js・pdf.js・upload.js・
bin/mdv.js と、3,964行の app.js には同じ規律が届いていない。

### 監査で確定した P1（要修正・優先順）

| # | 問題 | 場所 |
|---|------|------|
| 1 | **CSRF 無防備**: marpNote には Origin ガードがあるが、file 保存/削除/mkdir/move/upload/shutdown には無い。form POST で攻撃可能 | api/file.js, upload.js, server.js |
| 2 | **IGNORED_PATTERNS が2定義で乖離**: tree.js は3件、watcher.js は19件。dist/ venv/ 等がツリーに出る（フリーズ再発シナリオ）のに watch されない | api/tree.js:10 vs watcher.js:9-29 |
| 3 | **メイン保存経路が非アトミック**: POST /api/file は素の fs.writeFile。marpNote 用に作った atomicWrite+withPathLock が未適用 | api/file.js:202 |
| 4 | **errors.js SSOT の不採用**: res.status().json() 手書きが40箇所超、レスポンス形が2種、err.message で fs パス漏洩 | file/tree/pdf/upload/server |
| 5 | **escapeHtml がサーバー側に3実装**（エンティティ集合が乖離: markdown.js は3種のみ） | rendering/index.js, markdown.js, api/file.js |
| 6 | **readEditableText がバイト単位で重複** | app.js:992 = presenter.html:343 |
| 7 | **presenter 保存ルーティング状態機械が両ファイルにインラインでテストゼロ**（コード自身が「最難関」とコメント） | app.js PresenterView + presenter.html |
| 8 | **bin/mdv.js**: isMarp 再実装（SSOT違反）・export ゼロ（テスト不能）・サブコマンドがOCP違反 | bin/mdv.js |
| 9 | **app.js 3,964行・カバレッジ0**・CI 無し | src/static/app.js |
| 10 | **multer 1.x 非推奨（既知脆弱性、2.x で修正済み）** | package.json |
| 11 | **ドキュメント乖離**: テスト数が CLAUDE.md=76 / README=236 / 実際=302 | CLAUDE.md, README.md |

### app.js の解剖（分解の設計図）

単一 IIFE 内に **28 ブロック / 22 マネージャ**。全員が `state` と `elements` の2グローバルを直接読み書き。
最難関は「Marp クラスタ」（ContentRenderer + InlineNotesPanel + MarpSplitHandle + MarpZoom + PresenterView、
約1,400行、裸の `let marpCurrentSlide/marpKeyHandler` を共有）と、TabManager⇔EditorManager の相互呼び出し。
HTTP 呼び出し規約が4系統（MDVApi / apiRequest / 生fetch×2 / XHR）並存。

## 1. 設計原則（このリポジトリの憲法）

1. **SSOT**: 1つの概念は1箇所。定数は `src/config/constants.js`、無視パターンは `src/utils/ignorePatterns.js`、
   エラー語彙は `utils/errors.js`（+ クライアント公開）、HTML エスケープは `utils/html.js`。
2. **marpNote パターンが標準**: 新旧問わず全 API は「guard 分離 + handler factory（DI）+ sendError/mkError +
   atomicWrite/withPathLock（書き込み時）」に揃える。二重基準を残さない。
3. **zero-build 維持**: フロントはネイティブ ESM（`<script type="module">`）で分割。ビルドステップは導入しない。
4. **pure move と behavior change を分離**: 移動だけのコミットと挙動改善のコミットを混ぜない。
5. **安全網が先**: app.js に触る前に Playwright E2E スモークを整備（ツリー周りの手動検証依存を解消）。
6. **フロントの変更は実機確認まで**: npm test PASS ≠ 完了。E2E + Playwright 目視まで。

## 2. フェーズ計画

### Phase 1 — 安全網（テスト基盤 + CI）
- `tests/e2e/`: @playwright/test によるスモーク10本（起動/ツリー描画/展開/load-more/外部変更反映/
  ファイルopen/編集保存/Marpプレビュー/ノート編集/テーマ切替）。`npm run test:e2e`。
- `tests/helpers/server.js`: 9ファイルで重複するサーバー起動ボイラープレートの共通化。ポートはOS任せ。
- test-server.js / test-security.js の rootDir をリポジトリ実体から tmp fixture へ隔離（POST/DELETE 事故防止）。
- `.github/workflows/ci.yml`: npm test + E2E + npm audit --omit=dev + npm pack --dry-run。
- ESLint 最小構成（no-undef / no-unused-vars）+ `npm run lint`。

### Phase 2 — SSOT 統合 + セキュリティ二重基準の解消（バックエンド）
- `src/config/constants.js` 新設: DEFAULT_PORT(8642)/DEFAULT_DEPTH/MAX_CHILDREN_PER_DIR/サイズ上限/
  debounce/MAX_RELATIVE_PATH_LENGTH。bin/server/tree/websocket/guards が import。
- `src/utils/ignorePatterns.js` 新設: tree.js と watcher.js が同一リストを使用（P1-2 修正）。
- `src/utils/html.js` 新設: escapeHtml 一本化（5エンティティ）。3実装を置換。
- errors.js 全面採用: file/tree/pdf/upload/server の40箇所を sendError/mkError へ。不足コード追加。
  レスポンス封筒は `{ ok:false, code, error }` に統一（旧 `{error}` キーも当面残置で互換維持）。
- `src/api/middleware/originGuard.js`: marpNote の Origin/Host 検証を全ミューテーション
  （file POST/DELETE, mkdir, move, upload, shutdown, pdf/export）へ適用（P1-1 修正）。
- POST /api/file・move・delete を atomicWrite + withPathLock 経由に（P1-3 修正）。
- `resolveWithinRoot()` を utils/path.js に新設し5重複を統合。upload.js に realpath 検証を付与（弱点解消）。
- tree_update ブロードキャストを websocket.js の単一ヘルパーに集約（payload 形の乖離解消）。
- multer 2.x へ更新。`getVersion()` util 新設。

### Phase 3 — app.js 分解（ネイティブ ESM 化）
方針: `src/static/app.js` → エントリ（bootstrap のみ）+ `src/static/modules/*.js`。
lib/*.js は `export` を追加しつつ `globalThis.MDVXxx` も当面併存（presenter.html 互換）。
- 3a: constants / state / dom(elements) / utils / apiClient への HTTP 4系統統合（mkdir/move/delete/shutdown/css を MDVApi へ）
- 3b: 単独オーナー系（Theme/Sidebar/Resize/Shutdown/Dialog/PdfStyle/Keyboard）
- 3c: FileTreeManager + WebSocketManager（InlineNotesPanel 内部への直接アクセスをコールバック登録に置換）
- 3d: Marp クラスタ（marpState 共有モジュール新設 → ContentRenderer/InlineNotesPanel/MarpSplitHandle/
  MarpZoom/PresenterView。保存ルーティング状態機械は lib/ の純粋モジュールへ抽出しユニットテスト付与 = P1-7）
- 3e: TabManager/EditorManager（相互依存は既存 tabRegistry のライフサイクルフックで仲介）+
  FileOperations/ContextMenu/DragDrop/Print
- readEditableText を lib/notesEditor.js へ（P1-6）。エラーコード語彙を lib/errorCodes.js としてクライアント公開。
- 各段階のゲート: npm test + E2E 全PASS。挙動改善（applyRenderedFile 統一・debounce factory 等）は移動後に別コミット。

### Phase 4 — CLI・プロダクト面
- bin/mdv.js → `src/cli/`（サブコマンドレジストリ {name, options, help, run}・serverRegistry・convert）。
  export してユニットテスト可能に。isMarp は rendering から import（P1-8）。
  「helper は throw、exit は main() のみ」に統一。
- **設定ファイル対応**（プロダクト拡張点）: `.mdvrc.json` / `mdv.config.json`（port/depth/css/pdfOptions）。
  CLI 引数 > 設定ファイル > デフォルトの優先順。
- sync-vendor.js にバージョン記録 + 乖離検知テスト。setup-macos-app.sh のバージョンを package.json から取得。
- .npmignore 削除（files フィールドが正）。--dev 死にフラグ削除。multer 2.x（Phase 2 と同時でも可）。

### Phase 5 — ドキュメント SSOT
- CLAUDE.md 全面更新（実アーキテクチャ・テスト数はハードコードしない）。
- docs/ARCHITECTURE.md 新設（モジュール地図・「新しい API ルートの追加手順」チェックリスト）。
- README 整合。旧計画書と dogfood 記録は docs/archive/ / docs/qa/ へ。リポジトリルートの残骸掃除
  （.gitignore.tmp, test-marp.md は fixture 化, 孤児 tests/test-marp.md 削除）。

### 検収ゲート（全フェーズ共通）
npm test 全PASS → E2E 全PASS → lint → Playwright 実機目視（フロント変更時）→ codex クロスレビュー →
フェーズ単位でコミット。バージョンは 0.6.0（挙動変更: CSRF ガード・ツリー無視リスト拡大）。
publish はユーザー承認後のみ。

## 3. 非ゴール

- API エンドポイント名の変更（互換性破壊）
- ビルドステップ / フレームワーク導入（zero-build は製品特性）
- 真の仮想スクロール、多言語化
- vendor 同梱の廃止（オフライン完結は製品特性。サイズ最適化は将来検討）

## 4. 成功基準

- [x] res.status().json() 直書きが utils/errors.js 以外で 0
- [x] 無視パターン定義が 1 箇所
- [x] escapeHtml 実装がサーバー側 1 箇所
- [x] 全ミューテーション API に Origin ガード
- [x] POST /api/file が atomicWrite + withPathLock 経由
- [ ] app.js が 300 行以下の bootstrap になり、modules/ が各 500 行以下（app.js は388行、modules/diffReview.js は896行（0.6.9-0.6.12でReview mode統合に伴い677→896行へさらに乖離）・contentRenderer.js は515行で未達）
- [x] フロント HTTP 呼び出しが apiClient 経由に統一（XHR upload は文書化された例外）
- [x] E2E スモーク 10 本 + CI が回る
- [x] bin/mdv.js のロジックが src/cli/ で export されユニットテスト可能
- [ ] CLAUDE.md / README / 実コードの記述が一致
- [ ] npm test + E2E 全PASS、codex レビュー クリーン
