# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.18] - 2026-05-12

### Fixed — Offline operation

ビューワがネットワーク接続なしでも完全に動くようになった。これまで
`index.html` が 5 つの CDN (highlight.js / Mermaid / html2pdf.js / Tailwind /
hljs テーマ CSS) を直接読み込んでいたため、Wi-Fi 切断時はシンタックスハイ
ライト・図表・PDF 出力・全 UI スタイルが死ぬ状態だった。

- `src/static/vendor/` に各ライブラリのオフライン版を同梱
- `scripts/sync-vendor.js` でメンテナが version bump 時に node_modules /
  Tailwind Play CDN から再生成 (`node scripts/sync-vendor.js`)
- Tailwind は v3.4.17 で pin (v4 系は `tailwind.config` 構文が変わるため)
- `index.html` と `app.js` (`HLJS_THEMES`) の CDN URL を `/static/vendor/...`
  に置換
- 各ライブラリのライセンス本文を `vendor/licenses/` に同梱、
  html2pdf bundle が名指しする `html2pdf.bundle.min.js.LICENSE.txt` も sidecar 配置
- `@highlightjs/cdn-assets` / `mermaid` / `html2pdf.js` は **devDependencies**
  (vendor 元、runtime では使わないので global install 時にダウンロードされない)
- `tests/test-offline-assets.js` で「served HTML/JS に外部 CDN URL がない」
  「必須 vendor ファイル / license 一式が揃う」「vendor-only パッケージが
  dependencies に逆流していない」を 14 件の assert で常時保証

### Verified

- 272 テスト 全 PASS (既存 258 + 新規 14)
- Playwright dogfood (`docs/dogfood-offline-2026-05-11/`): 非 localhost への
  リクエスト 0 件、code highlight / mermaid / Tailwind / edit autosave /
  theme 切替 / Marp split layout / inline notes すべて回帰なし
- Codex review 2 round で「No actionable regressions」収束

## [0.5.17] - 2026-05-10

### Added — Edit-mode Autosave

Markdown エディタを **入力 → 1500ms debounce で自動保存** に。これまで Cmd+S を
押し忘れると未保存で View に戻すと内容が消える挙動だった。

- `input` で 1500ms debounce → `EditorManager.save()` が `/api/file` に POST
- toolbar status の遷移: `Modified → Saving... → Saved! → (2s 後) Ready`
- **Cmd+S** は引き続き使えて、押すと pending な debounce を即 flush
- View 切替 / タブ切替 / 別ファイル open 時に **flush + await** で未保存破棄事故を防止
- save 中の連続 input は serialize（chain）。古い save が後着して新しい save を
  上書きしないよう、各 save 自身の Promise を chain tail にして flush は末尾まで drain
- save 失敗時は `hide()` / `switch()` / `open()` がすべて navigation を中止して
  Edit mode を維持。toolbar に `Error: ...` を表示してリトライ余地を残す
- discard-on-close ダイアログ: AbortController で in-flight POST も abort。
  ただしサーバーが既に request 受信済みの race window は残るため、ダイアログ
  メッセージで「自動保存処理中の場合、その時点までの内容がファイルに残る可能性が
  あります」と明示

### Changed

- `MDVApi.saveFile(path, content, signal?)` に AbortSignal 引数追加（既存
  caller は signal 省略で動作継続）
- `TabManager.switch()` を `async` 化（path で target を pin → flush await →
  index 再 lookup で navigation race 回避）
- save 成功時に `MDVApi.fetchFile(path)` を chain 内で await して
  `tab.{content,css,notes,notesMultiplicity,etag,isMarp}` を更新（古い fetch
  が新しい fetch の後に到着して content を上書きする race を排除）

### Fixed (codex review round 1〜14 で潰した issues)

- 保存中に typing 続いた場合の dirty フラグ誤クリア（live editor とのテキスト一致
  を確認してから "Saved!" 表示）
- 連続 autosave で古い ETag の POST が新しい save の後に到着して overwrite
- BroadcastChannel 経由じゃない、HTTP 経路独自の serialize chain
- 編集中のタブを close したときに edit mode flag が残る regression
- discard-on-close で saveTimer / inFlight 両方 abort + lastAutosaveError も clear
- open() で fetch 中の typing をブロック（textarea.readOnly）+ error 時に restore
- debounce-fired save が silent fail したまま flushAutosave が成功扱いする問題
  （`lastAutosaveError` を保持し、navigation 時に再 throw）

## [0.5.16] - 2026-05-09

### Added — Inline Speaker Notes (PowerPoint-style)

メインプレビューに **PowerPoint 風の上下分割レイアウト** を追加。

- 上 = スライドステージ、下 = スピーカーノート編集領域、間に**ドラッグ可能な
  仕切り**。ノート領域を広げるとスライドが連動して縮む（CSS Grid: `1fr` /
  ハンドル / `--marp-notes-row`）。
- 仕切りは:
  - ドラッグでリサイズ → `localStorage` (`mdv-notes-row-px`) に永続化
  - ダブルクリックでデフォルト 240px にリセット（短いビューポートでは clamp）
  - ビューポートに対して `SLIDE_ROW_MIN_PX` を超えないよう attach 時 / drag 中に clamp
  - 0px (完全閉じ) も有効値として保存され、リロードしても復元
- ノート編集は `contenteditable`、**800ms debounce で自動保存**。Presenter View
  と同じ `/api/marp/decks/:path/slides/:N/note` API、ETag 楽観的ロック、STALE
  時はバックアップを `localStorage` に退避。
- 多コメントスライド (`notesMultiplicity > 1`) と etag 不在のデッキは編集不可化、
  banner で警告。
- スライドナビ (← / → / Space / N / F / P) はノート編集中に **無効化** (keydown
  stopPropagation)。
- スライド切替 → アクティブな panel のみ表示 (JS 駆動の `.active` クラス)。

### Changed — saveQueue contract

- `enqueue()` が **`Promise<{ok, etag, reason, code}>`** を返すように変更
  (既存 caller は戻り値を無視して動作継続)。
- `enqueue()` / `saveFn` に **`origin`** 引数 (`'presenter'` / `'inline'` / undef)
  を追加。coalesce / rebase / `lastSavedEtag` を **per-origin** で管理し、
  Presenter ↔ Inline の同時編集で互いの ETag を踏まないようにした。
- COALESCED / DROPPED の場合、superseded な enqueue() は対応する sentinel で
  resolve する (caller が `await` で永遠に止まらない)。

### Changed — Marp viewer

- `position: fixed` の `.marp-nav` を半透明 backdrop で右下に floating（広い
  notes panel と被ってもスライド/ノートが透けて見える）。
- `body.marp-fullscreen` 時はノート領域・ハンドルを 0 行にして全画面プレゼン。
- 印刷 (`@media print`): split・ハンドル・ノート領域を hide、`.marpit` を
  `display: block` に戻して 1 ページ 1 スライドに復帰（multi-slide PDF が 1 枚に
  collapse する regression を fix）。

### Fixed (codex review round 1〜10 で潰した issues)

- file_update が編集中に来た場合の deferred render（focus blur 後に再描画）
- tab 切替中の status 誤配信 / 誤った deck の STALE backup 上書き
- drag 中に detach されたとき body cursor / userSelect の残留
- BroadcastChannel 不在環境での `queue 未初期化` regression（saveQueue を channel
  から独立させた）
- Presenter editing 中に inline 由来の `note-saved` で status / backup が汚染
- 古い save が完了した時点で `保存済み` と表示する誤報（live editor とのテキスト
  一致 + pending timer 不在を確認）

### Tests

- 251 → **257 件 (+6)**:
  - saveQueue の Promise 返却 / COALESCED / DROPPED / origin forwarding /
    per-origin coalesce 5 件
  - 既存 saveQueue regression の vm sandbox 互換 fix 1 件

## [0.5.15] - 2026-05-09

### Refactored

- **PDF 生成ロジックを `src/services/pdf.js` に集約**:
  - サーバー HTTP route (`src/api/pdf.js`) と CLI (`bin/mdv.js convert`) の
    両方が **同じ実装** を共有
  - bug fix・security check (realpath/symlink)・hoist 対応・stdin pipe ハング
    対応・workspace 汚染回避 (temp copy) が 1 箇所に集約。今後どちらの経路
    でも同じ品質を保つ
- **CLI から `npx` を完全排除**:
  - 旧: `execFileSync('npx', ['md-to-pdf', ...])` / `npx @marp-team/marp-cli`
  - 新: `services/pdf.js` の `exportMarpPdf` / `exportMarkdownPdf` を直接呼ぶ
  - 効果: registry 不通でも動く、バージョン揺れ防止、サーバー側と整合

### Changed (breaking-ish)

- **`md-to-pdf` を `optionalDependencies` に降格** (旧 `dependencies`):
  - デフォルト `npm install mdv-live` で puppeteer/chromium DL がほぼ消滅
    し、install 大幅軽量化 (Marp 使わない人は完全 skip)
  - `@marp-team/marp-cli` も同じく optional (従来通り)
  - PDF 機能 (Plain Markdown / Marp 両方) を使う場合は `--include=optional`
    か通常 `npm install` (default で optional も入る)。CI で `--omit=optional`
    してると `PDF_TOOL_UNAVAILABLE` になり 503 / exit 1 + 案内
  - **既存ユーザー影響**: `npm install --omit=optional` していた人は要再 install

### Tests

- 247 → **249 件 (+2)**:
  - `src/services/pdf.js` の import が throw しない
  - `bin/mdv.js` が `npx` を呼んでいない (regression guard)

### Chore

- `tests/fixtures/html-preview/` `tests/fixtures/marp-notes/` を `.gitignore`
  に追加 (test-html-preview.js が runtime に書き出す artifact)
- `CODEX.md` を git 管理に追加 (codex review の Project ルール)

### Docs

- README に **依存パッケージは optional 扱い** であることと install 方法を明記

## [0.5.14] - 2026-05-09

### Changed — Style PDF dispatch をリファイン

`PdfStyleManager` の dispatch 判定を **「PDF options JSON の有無」** に変更
(これまでは「CSS or JSON のいずれか」で server PDF 経路に切り替わっていた)。

| CSS | PDF options | PDF ボタン押下で |
|---|---|---|
| 空 | 空 | 印刷ダイアログ |
| 入れる | 空 | **印刷ダイアログ** (preview CSS が styled DOM で print engine に渡る) |
| 入れる/空 | 入れる | サーバー md-to-pdf で styled PDF 自動 DL |

JSON は margin/format/printBackground 等の細かい制御用。CSS だけ当てて
PDF にしたい普通のケースは印刷ダイアログで十分なので、md-to-pdf 経路に
無闇に流さない。`shouldUseServerPdf()` メソッドに rename。

### UX improvements

- **Style パネルの placeholder/tooltip** を rootDir 相対パス前提のヒント
  に変更 (`report.css (rootDir からの相対パス)` 等)。Claude Code 等で
  ファイル生成して入力する人が迷わないように
- **失敗時のステータスメッセージ詳細化**: 旧「Style failed」→ 新
  「Style failed: CSS not found: <path>」のように原因を出す。表示時間
  も 2.5s → 4.5s に延長 (読み切る時間)
- **PDF export 失敗時** もサーバーから返されたエラーメッセージを
  ステータスバーに表示

### Docs

- README の `Web UI` 節を全面改訂: dispatch テーブル + Claude Code 連携手順

## [0.5.13] - 2026-05-09

### Restored

- **PDF Style customization (Watanabe @watanko `933147f` の機能)**:
  0.5.10 で僕が誤って "orphan" と判断し削除してしまった機能を復元。
  README にも記載されている公開機能を黙って消したのは判断ミス。

  - Web UI: `Style` ボタン + パネル (CSS path / PDF options JSON 入力)
  - サーバー: `/api/pdf/export` の Markdown 経路 (md-to-pdf 経由) を復活
  - `md-to-pdf` を `dependencies` に再追加

### Added — A2 dispatch

  Markdown PDF ボタンの動きを **Style 設定の有無** で切り替える:
  - **Style 未設定** (デフォルト) → 印刷ダイアログ (`window.print()`) ← 0.5.10 の岡本意図
  - **Style 設定済** (CSS or PDF options 入力 + Apply) → サーバー md-to-pdf
    で styled PDF DL ← 渡邉さん設計

  実装: `PdfStyleManager.hasStyle()` を新設し、`PrintManager.print()` の
  Markdown 分岐で分岐。Marp は引き続きサーバー一択。

### Fixed

- `src/api/pdf.js` の md-to-pdf bin 解決を hoist 安全 + lazy 化:
  `node_modules/.bin/md-to-pdf` 直叩きをやめ、`require.resolve('md-to-pdf/package.json')`
  で解決。Marp 側と同じ `resolvePkgBin()` ヘルパに統一。
  欠如時は `code: 'PDF_TOOL_UNAVAILABLE'` で 503 (Marp と同じパス)

### Tests

- 244 件全 PASS (plain markdown PDF テスト復活、415 テスト削除)

## [0.5.12] - 2026-05-09

### Fixed

- **Server fails to boot when `@marp-team/marp-cli` is missing** (codex P1):
  - 0.5.11 で `require.resolve('@marp-team/marp-cli/package.json')` を
    `src/api/pdf.js` の **module top-level** で実行していたため、optionalDependency
    が欠ける環境 (`npm install --omit=optional`、platform 起因の install 失敗等)
    で `import` 時に throw → サーバー全体が起動不能
  - 解決を `runMarp()` 呼出時の lazy 実行に変更 (`resolveMarpEntry()`)
  - 解決失敗時は `code: 'MARP_CLI_UNAVAILABLE'` を投げ、route handler 側で
    503 (+ 案内メッセージ) に変換。markdown / 415 経路は marp 不在でも動く

### Tests

- 243 → **244 件 (+1)**: `src/api/pdf.js` の import が throw しない regression test

## [0.5.11] - 2026-05-09

### Fixed

- **Marp PDF export ENOENT in fresh install** (実は 0.5.5 から潜在):
  - `src/api/pdf.js` が marp 実行ファイルを
    `node_modules/mdv-live/node_modules/.bin/marp` で解決していたが、npm
    hoisting により実体は top-level の `node_modules/.bin/marp` にある
  - dev 環境 (mdv-live リポ内) では nested の方が存在するため気づかず、
    `npm install mdv-live` した fresh install では ENOENT
  - `require.resolve('@marp-team/marp-cli/package.json')` から bin スクリプト
    を解決し `node` で実行する方式に変更 (hoist/nest 両対応)

### Tests

- 242 → **243 件 (+1)**: marp-cli bin entry の実在チェック regression test

## [0.5.10] - 2026-05-09

### Fixed (UX revert)

- **Markdown PDF ボタンを OS 印刷ダイアログに戻す** (本来の UX 復元):
  - 0.5.9 (実体は 2026-01-31 `e5526f9` から) で plain Markdown も server-side
    md-to-pdf 経由の PDF DL に切り替わっていたが、本来の UX は `Cmd+P` 相当の
    OS 印刷ダイアログ (`window.print()`) で「PDF として保存」を選ぶフロー
  - `src/static/app.js`: `print()` の markdown 分岐を削除 (`else` 分岐の
    `browserPrint()` に落ちる)
  - Marp / HTML preview の挙動は変更なし (server-side marp-cli を維持)

### Fixed (codex review)

- `/api/pdf/export` の `fs.readFile` を `try/catch` 外で実行していた問題を修正
  (directory 指定や読み取り不可ファイルで Express デフォルトエラーに落ちて
  controlled JSON が返らなかった)。stat による file 判定を追加

### Removed

- `PdfStyleManager` UI モジュール (markdown が server PDF を使わなくなったため
  orphan)、`pdfStyleToggle` / `pdfStylePanel` HTML、関連 CSS、`normalizeUserPath`
  helper、`pdf-style-preview` クラス
- `md-to-pdf` runtime dependency。web UI で使わなくなったため削除。
  `bin/mdv.js convert` は元々 `npx md-to-pdf` 経由で 0.5.9 以前と同じ挙動
- `/api/pdf/export` の markdown 分岐 (Marp 専用エンドポイントに整理)。
  非 Marp ファイルは 415 で拒否

### Tests

- 241 → **242 件 (+1)**、全 PASS
- 追加: directory path → 404 controlled JSON (codex round 3 regression)
- 変更: plain markdown PDF テスト → 415 テストに置換

## [0.5.9] - 2026-05-09

### Fixed

- **PDF export hang for plain Markdown** (regression since 2026-01-31 `e5526f9`):
  - 原因 1: `md-to-pdf` が `package.json` に未宣言だったため `npx md-to-pdf` 経路に
    依存。npx キャッシュ / TTY / レジストリ状況により挙動が不安定
  - 原因 2: `child_process.execFile` は `stdio` オプションを受け付けない (Node 仕様)。
    `md-to-pdf` 内部の `get-stdin` が EOF を待ち続け 180s SIGTERM していた
  - 直し方: `md-to-pdf` を `dependencies` に追加 / `npx` 経由をやめて
    `node_modules/.bin/md-to-pdf` を直接 spawn / `stdio: ['ignore', ...]` で stdin 即 EOF
  - Marp 経路 (`marp-cli`) も同じ helper (`runPdfTool`) に統一して防御

### Added

- `tests/test-pdf-export.js`: PDF export 経路の自動テスト 5 件 (400 / 403 / 404 / plain
  PDF / Marp PDF)。リグレッション再発防止

### Tests

- 236 → **241 件 (+5)**、全 PASS

## [0.5.8] - 2026-05-08

### Fixed

- **Symlink TOCTOU on note auto-save** (codex-loop で 4 round 連鎖修正):
  - 旧コードの TOCTOU guard が `earlyDeck.realPath` (lock 取得前) と比較
    していた → 進入後 swap、戻し、書き込みで別ファイル読み出しが original
    path に書ける race を塞ぐため `deck.realPath` (in-lock) と比較に修正
  - in-lock で realpath が変わったら mutex 範囲外の書込みになる →
    detection を入れて再 lock 取得
  - 再 lock 取得を server-side 自動 retry で実装 (client は STALE 以外を
    terminal 扱いするため)
  - retarget retry の入れ子 lock が opposite retarget で deadlock し得る
    → trampoline で **outer lock 解放後に新 realpath を取得**

### Added

- TOCTOU 正常系の API regression test
- SaveQueue coalesce/serialize/dropPath/例外耐性 5 件
- Sec-Fetch-Site=same-origin の B 受理パス + cross-site 拒否

### Architecture (refactor)

- `src/api/marpNote.js` orchestration を 38 行に。実装は `src/api/marpNote/`
  配下の `guards.js` / `readDeck.js` / `handleGet.js` / `handlePut.js` に分割
- `src/static/lib/saveQueue.js` (per-deck queue + per-slide coalesce、純 JS)
- `src/static/lib/tabRegistry.js` (tab close hook → メモリリーク解消)
- `src/static/lib/apiClient.js` を deck/file/tree/info/pdf 用に拡張、
  app.js の fetch 直叩きを 13 → 2 (WebSocket / /raw/ のみ残存)
- `src/concurrency/pathLock.js`: promise-chain ベースの正しい mutex
  (旧 naive Map 実装の thundering-herd race を排除)
- `src/utils/errors.js`: mkError + ERROR_STATUS テーブル + sendError SSOT
- `src/utils/etag.js`: ETag 計算 SSOT
- placeholder を CSS pseudo-element 化 (`:empty::before`) で
  contenteditable に placeholder text が混入する罠を構造的に解消
- STALE 通知時に編集テキストを localStorage に自動退避

### Tests

- 222 → **236 件 (+14)**、全 PASS

## [0.5.7] - 2026-05-08

### Added

- **Presenter View** (Marp スピーカーノート別ウィンドウ表示・編集)
  - P キー (Cmd/Ctrl 修飾なし) または Marp ナビボタンで起動
  - Current / Next スライド + Speaker Notes + 経過タイマーを並列表示
  - パネルサイズはドラッグハンドルで変更可能 (localStorage 永続化)
  - BroadcastChannel `mdv-marp-presenter` でメイン⇄presenter 双方向同期
- **スピーカーノートの自動保存**: presenter ノートパネルをクリック→編集→
  800ms デバウンスでサーバへ PUT。ソース markdown の HTML コメントを書き換え
- **`/api/marp/decks/:path` エンドポイント** (GET/PUT/OPTIONS)
  - **ETag 楽観ロック** (`sha256:`) で外部編集との衝突検出
  - **per-path 非同期 mutex** で同時 PUT を直列化
  - **Multi-note Guard**: 1 slide に複数ノートがある場合は read-only
  - **CSRF**: Origin + Sec-Fetch-Site + Content-Type 厳密検証
  - **PNA preflight 拒否** (localhost 同一オリジン要求)
  - **128KB body limit + 専用 413 ハンドラ** で情報漏洩防止

### Architecture

- Marp スライド範囲・ノート位置の特定を **Marpit token** に委譲する
  `marpitAdapter` を新設。regex 再実装の脆弱性を構造的に解消
- `validatePathReal` + `O_NOFOLLOW` + realpath 二重解決で symlink swap
  best-effort 防御
- `atomicWrite` で `O_EXCL` temp + chmod EPERM 限定 + EXDEV 二段 rename +
  uid+mtime sweep
- BOM/CRLF/CR/UTF-8 surrogate pair 安全な行↔バイト変換ヘルパに集約
- 共通 error コード/HTTP status マッピングを `utils/errors.js` に SSOT 化
- promise-chain ベースの正しい mutex (`concurrency/pathLock.js`) で
  thundering-herd race を排除
- HTTP client / BroadcastChannel 名 / message schema を専用ライブラリに分離
- セキュリティ脆弱性 5 件 (basic-ftp / ip-address / postcss) を `npm audit fix`

### Tests

- 既存 119 → **228 件 (+109)** すべて PASS
- 性能: 500 slides / 155 KiB ファイルで parseDeck+rewrite 86ms

## [0.5.6] - 2026-04-27

### Added

- Markdown PDF変換用の `mdv convert` サブコマンドを追加
- `-s <css-file>` によるPDF変換用CSS指定を追加
- `--pdf-options <json-file>` によるPuppeteer PDF options指定を追加
- Web UIのStyleパネルを追加
  - CSSファイルパスを指定可能
  - PDF options JSONファイルパスを指定可能
  - 指定CSSをMarkdownプレビューに反映
  - `Clear` でスタイル指定を解除可能
- 通常MarkdownのWeb UI PDF exportを `md-to-pdf` に対応
- PDFスタイル指定のサンプルを追加
  - `src/styles/report.example.css`
  - `src/styles/report.pdf-options.example.json`

### Changed

- PDF出力設定をCSSとPDF options JSONに分離
- Marp PDF出力は従来どおりMarp CLIを使用し、通常Markdown PDF出力のみ `md-to-pdf` を使用

## [0.5.5] - 2026-04-05

### Fixed

- タスクリストのインライン要素（太字・リンク・コード）が二重表示されるバグを修正
  - markdown-it-task-lists の labelAfter オプション誤用が原因
- Mermaidプレースホルダがユーザーコンテンツと衝突する問題を修正（nonce付与）
- 空frontmatter（`---\n\n---`）で空のyamlコードブロックが生成される問題を修正

### Removed

- 未使用の `src/rendering/slides.js` を削除（marp.jsに統合済み）

### Added

- WebSocketテスト7件（接続追跡・watch・broadcast・通知・cleanup・不正入力耐性）
- レンダリングテスト10件（strikethrough・CJK emphasis・linkify・breaks・mermaid edge cases）
- テスト総数: 92 → 109

## [0.5.4] - 2026-04-04

### Fixed

- 4件の依存関係脆弱性を修正

## [0.5.3] - 2026-03-29

### Fixed

- Security: exec/execSync → execFile/process.kill でコマンドインジェクション防止（PDF生成・サーバーkill）
- Security: PIDバリデーション厳密化（数字のみ許可、部分一致を拒否）
- Range Requestのバリデーション追加（不正ヘッダで416、end超過はRFC準拠でclamp）
- ファイル監視の再描画でrelativeDirを渡すように修正（サブフォルダ内Markdownの画像パス解決）
- バージョン表示をpackage.jsonから動的取得に統一（CLI・サーバー・テスト全箇所）

## [0.5.2] - 2026-03-27

### Fixed

- CJK + Unicode句読点で太字・斜体が壊れる問題を修正

## [0.5.1] - 2026-03-20

### Fixed

- Edit mode + PDF export bug: exporting PDF while in edit mode produced raw markdown text instead of rendered slides
  - Now auto-exits edit mode before PDF generation
  - Uses `tab.isMarp` fallback for Marp detection when DOM is not yet rendered

## [0.4.3] - 2026-02-15

### Fixed

- macOS app: Japanese filenames garbled when opening via Finder double-click
  - `osascript open location` corrupted UTF-8 characters in URL
  - Now URL-encodes filename with `python3 urllib.parse.quote()` and uses `open` command

## [0.3.3] - 2026-01-31

### Fixed

- Print preview missing padding on markdown content

## [0.3.2] - 2026-01-31

### Changed

- Refactored codebase with extracted helper functions and constants
- Simplified CSS with consolidated variables (--success, --warning, --danger)
- Reduced styles.css by 84 lines, app.js by 45 lines
- Added ARIA attributes for improved accessibility
- Standardized test helpers and imports

### Fixed

- File tree not updating on file structure changes (add/delete/rename)

## [0.3.1] - 2026-01-31

### Changed

- Minor code cleanup and organization

## [0.3.0] - 2026-01-31

### Added

- Initial Node.js version (rewrite from Python mdv-live)
- Express server with WebSocket for live reload
- markdown-it for standard Markdown rendering
- @marp-team/marp-core for Marp slide rendering
- File tree navigation with lazy loading
- Edit mode with textarea editor
- Dark/Light theme support
- Syntax highlighting with highlight.js
- Mermaid diagram support
- PDF output via browser print
- File operations (create, delete, rename, move, upload)
- Keyboard shortcuts for common actions
- Task list (checkbox) support with markdown-it-task-lists
- Range Request support for video/audio streaming
- WebSocket tree_update broadcast for multi-client sync
- Comprehensive security tests (76 tests)

### Security

- Path traversal prevention (absolute path, `..`, null byte)
- Filename sanitization for uploads
- Unified validatePath() for all API endpoints

### Marp Features

- Full compatibility with marp-core
- Official themes: default, gaia, uncover
- All directives: paginate, header, footer, backgroundColor, etc.
- Background images and split backgrounds
- KaTeX math support
- Slide navigation with arrow keys

### CLI Features

- Port auto-increment when port is in use
- Server list (`mdv -l`)
- Server kill (`mdv -k PID` or `mdv -k -a`)
- PDF conversion (`mdv --pdf file.md`)
- No-browser mode (`mdv --no-browser`)
