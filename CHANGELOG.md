# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.13] - 2026-07-06

### Changed

- Review ボタンにアイコン（目・Heroicons outline）を追加（オーナー指摘）。
  ツールバーで唯一アイコンが無いボタンだったのを Edit/PDF/Style と統一

## [0.6.12] - 2026-07-06

### Changed — 「Review」ボタン1つに統一（Wordの校閲タブ方式・オーナー指示）

ツールバー（Edit/PDF/Styleの右）に常設の **Review** ボタンを追加し、
検収UI全体をこの1つで ON/OFF する方式に変更:

- **OFF（既定）**: 完全に素のビューア。未読●・件数・変更ボタン・
  ハイライト・取り消し線は一切出ない（裏では記録が続くので、
  ONにした瞬間にそれまでの変更が正確に表示される）
- **ON**: 全部出る。ハイライトは常時表示になり、0.6.10の
  表示切替サブトグルは廃止（スイッチは1つだけ）。
  「変更 N」クリックは次の変更へジャンプに変更

## [0.6.11] - 2026-07-06

### Fixed

- サイドバーの幅ドラッグが重く感じる問題（オーナー報告）を修正。
  原因は3つ: 幅に畳み用の0.2秒アニメーションが掛かったままカーソルを
  追いかけていた／マウス移動のたびに設定を同期保存していた／描画間隔を
  超える頻度で幅を書き換えていた。ドラッグ中はアニメーション停止・
  保存は離した時に1回・幅更新は毎フレーム1回に

## [0.6.10] - 2026-07-06

### Added — Word風マークアップモード完成（オーナー指示）

- **削除された行が、元あった場所に赤の取り消し線付きで表示される**
  （Wordの変更履歴と同じ見え方。ファイルには書き込まない・印刷に出ない・
  8行超は折りたたみ）
- 「変更 N」トグルは**全ファイル共通・ブラウザに記憶・既定OFF**。
  OFFでも件数ボタンは灯るので変更があったことはわかる
- ハイライト色は**黄一色**に統一（追加=緑を廃止）

### Fixed

- 空になったファイルが画面上で古い内容のまま表示され続ける問題
  （全文削除ケースの検証で発見）

## [0.6.9] - 2026-07-06

### Documentation

4視点監査（README・エージェント向けマップ・リリースメタデータ・
初見ユーザー再現テスト）で見つかった17件のズレをすべて修正。
キーボード表のOS別修飾キー注記、API表への /api/search・/api/diff 追加、
ARCHITECTURE の WSメッセージ仕様更新（removed種別・✓廃止反映）、
npm の description/keywords を検収ビュー軸に更新など。コード変更なし。

## [0.6.8] - 2026-07-06

### Changed — Word風に引き算（オーナー指摘によるリデザイン）

- タブ下の差分バー（3行目）を**廃止**。変更があるときだけツールバーに
  「変更 N」トグル（ハイライトON/OFF）と「✓ 確認」が現れる。
  変更がなければ画面に検収UIは一切出ない
- ツリーの緑✓（既読マーク）を**廃止**。残るのは未読の青●と
  フォルダの未読数のみ

## [0.6.7] - 2026-07-06

### Fixed

- macOS で Ctrl+K が検索に横取りされ、エディタ標準の「カーソル以降を
  削除」が使えなかった問題を修正。ショートカット修飾キーをOS別に分離
  （macOS=⌘のみ・Windows/Linux=Ctrl）。Ctrl+E/P/B 等の編集キーも解放

## [0.6.6] - 2026-07-06

### Improved

- 変更ハイライトが**箇条書きの行そのもの**に付くように（従来は直前の
  見出し等に付いていた）。議事録の決定事項・宿題が主戦場のため効果大
- README に「AIエージェント時代の検収ビュー」節を追加（0.6.1〜0.6.5 の
  検索・Excelプレビュー・変更ハイライト・未読バッジを整理）

## [0.6.5] - 2026-07-06

### Added — 未読●/✓バッジ（検収ビュー第2弾）

ファイルツリーに「まだ見ていない変更」が見えるようになった:

- 外部で変更/新規作成されたファイルの行に **青●**、確認済みに **緑✓**
- フォルダ行に配下の未読数バッジ、サイドバーヘッダに合計チップ
- チップクリック / ⌥⇧↓ で「次の未読へ」ジャンプ
- フォルダ右クリック →「フォルダ内を確認済みにする」で一括確認
- 完全イベント駆動（`files_changed` WS ブロードキャスト・200ms合流）。
  ツリーのハッシュ走査はしない。基準は 0.6.4 の確認基準と同一（SSOT）

### Internal

GPT-5.5 クロスレビュー8周（10指摘修正: 削除ゴースト・再作成レース・
イベント順序逆転・シーケンス表リーク・ショートカット衝突ほか）。

## [0.6.4] - 2026-07-05

### Added — 変更ハイライト（AIエージェント時代の検収ビュー第1弾）

開いているファイルが「前回確認した時点」から変わると、タブ下に
「前回確認 HH:MM から N箇所変更されました」バーが出て、追加行は緑・
変更行は黄・削除位置はマーカーでハイライトされる（Markdown）。
⌥↑↓ で変更箇所ジャンプ、トグルでON/OFF、「最新を確認済みにする」で
基準を更新。基準はブラウザに保存され、プロジェクト（配信ルート）毎に分離。
Marp/コード/テキストはバーのみ（v1）。印刷・フルスクリーンには混入しない。

### Removed — プレビュー下のダウンロードボタン

Officeプレビュー・再生不可動画カードのダウンロードボタンを撤去
（サイドバー右クリック → ダウンロード に一本化。岡本判断）。

### Internal

GET /api/file が全テキストで内容ハッシュ(etag)を返すように。
GPT-5.5 クロスレビュー17周（22指摘修正: 状態×非同期×再描画経路の
組合せ — タブ切替・WS再接続・サーバー再起動・編集モード・presenter窓）。

## [0.6.3] - 2026-07-05

### Internal — 変更検知バックエンド（0.6.4 の差分ハイライトの土台）

- `src/utils/lineDiff.js`: 依存ゼロの行差分（Myers）。メモリ予算付きで
  巨大・全面変更ペアは安全に打ち切り
- `src/services/changeJournal.js`: パス毎のスナップショット台帳
  （内容ハッシュキー、50MB LRU・1MB/版・4版/ファイル）
- `GET /api/diff?path=&from=<hash>`: 追加/変更/削除位置のハンク応答。
  ベースライン不明・大きすぎ等は 200 のデータとして返す
- WS `file_update` が全テキストファイルで内容ハッシュ(etag)を持つように

ユーザー可視の変更はなし（フロントは 0.6.4 で載る）。

## [0.6.2] - 2026-07-05

### Changed — Excel プレビューが「読める表」になった

実案件ファイルでの検品と GPT-5.5 クロスレビュー14周（指摘19件修正・1件は
意図的仕様として文書化）による全面改善:

- **日付・時刻**: シリアル値(46208)→ 2026/7/5。時刻/経過時間書式([h]:mm等)・
  和暦系ビルトイン・1904年系・うるう年互換(1900/2/29)・深夜0時の繰り上がり対応
- **数式セル**: 計算結果キャッシュが無い場合(openpyxl生成等)は =数式 を
  グレー表示（値の列が丸ごと消えていた）。キャッシュ値には書式適用
- **%・桁区切り**: 0.62→62%、1485000→1,485,000（小数精度は保持）
- **セル折返し**: 長文セルが表を画面外へ押し広げ他の列が見えなくなる問題を修正
- **空行・幽霊列**: 末尾空行の抑制、トリム後の列数再計算、空白テールの誤った
  「行数が多いため…」通知を解消
- 名前空間プレフィックス付き OOXML (<x:c>等) への耐性

## [0.6.1] - 2026-07-05

### Added — フォルダ横断の全文検索（⌘K / Ctrl+K）

ツリーに表示される markdown/コード/テキストをリテラル検索（smart-case）。
ファイル別グルーピング・ヒットの <mark> 強調・↑↓/Enter/Esc 操作、Enter で
該当ファイルを開いて該当ブロックへスクロール+フラッシュ表示する。
`GET /api/search`（1ファイル1MB・結果500件・走査5,000ファイル上限）。

### Internal — レンダリング HTML にソース行マッピング

markdown-it の token.map からブロック要素へ `data-source-line`（1始まり・
frontmatter/mermaid 変換分を逆補正済み）を付与。検索ジャンプと 0.6.x 後半の
変更ハイライトの共通基盤。

## [0.6.0] - 2026-07-05

### Added — Office 雰囲気プレビュー（.xlsx / .pptx / .docx）

20MB 以下の `.xlsx`（先頭シートの表 + シート名一覧）/ `.pptx`（スライドごとの
テキストアウトライン）/ `.docx`（段落の羅列）を、レイアウト再現なしの
「雰囲気プレビュー」としてブラウザ内で確認できるようになった（fflate による
zip+XML 軽量パース、`src/rendering/office.js`）。破損・パスワード付き・20MB 超・
旧形式（`.doc`/`.xls`/`.ppt`）は従来通りダウンロードカードにフォールバック。

### Added — 再生できない動画のフォールバック表示

MPEG-4 Part 2 / HEVC などブラウザが再生できないコーデックの動画を開いたとき、
真っ黒なプレイヤーの代わりに案内とダウンロードボタンを表示するようになった。

### Security — 全ファイル変更系 API に CSRF (Origin/Host) ガード

これまで Origin/Host 検証が実装されていたのは marpNote（スピーカーノート
自動保存）エンドポイントのみで、ファイル保存/削除/`mkdir`/`move`/
アップロード/サーバー停止は無防備だった（悪意ある外部ページからの form
POST で操作できてしまう構成）。`src/api/middleware/originGuard.js` に
Origin/Host 検証ロジックを一本化し、これらすべての変更系 API と
`POST /api/pdf/export`（任意ファイルを PDF 変換ツールに渡す POST）に適用した。

### Changed — メインのファイル保存経路がアトミック + ロック方式に

`POST /api/file` が素の `fs.writeFile` 呼び出しから、`atomicWrite`
（一時ファイル + rename、別ファイルシステムをまたぐ場合のフォールバック、
パーミッション保持）と `withLock`（パスごとの Promise チェーン mutex）を
経由する方式に変わった。書き込み中のクラッシュや同時書き込みでファイルが
壊れる・混ざるリスクを解消。

### Fixed — ファイルツリー表示とファイル監視の無視リストが乖離していた

ファイルツリー (`node_modules`/`__pycache__`/`.git` の3件のみ無視) と
ファイル監視 (`dist/`・`venv/` など19件を無視) が別々の無視リストを
持っており、ツリーには表示されるのに外部からの変更が監視されず反映されない
ディレクトリが存在した。`src/utils/ignorePatterns.js` に無視リストを
一本化し、この乖離を解消。

### Added — `mdv.config.json`（プロジェクトごとの設定ファイル）

サーブ対象ディレクトリ（`mdv convert` の場合はカレントディレクトリ）に
`mdv.config.json` を置くと、`port`/`depth`/`open`/`css`/`pdfOptions` を
毎回 CLI 引数で指定しなくてもプロジェクトごとに固定できる。優先順位は
**CLI 引数 > `mdv.config.json` > 組み込みデフォルト**。`css`/`pdfOptions`
はビューワの Style パネルにも自動で初期値として入る（パネルでの手動設定
= ブラウザ記憶が常に優先）。

### Changed — エラーレスポンスの形を統一

各ルートで個別に書かれていた `res.status().json({...})` を廃止し、
`src/utils/errors.js` の `sendError`/`mkError` 経由に統一。レスポンスは
すべて `{ ok: false, code, error }` の形になり、内部の fs パス等が
エラーメッセージに漏れることもなくなった。

### Changed — multer を 2.x に更新

既知の脆弱性が修正された `multer` 2.x に更新。

### Internal（開発者向け・API 互換性への影響なし）

- フロントエンドの単一 IIFE（旧 `app.js`、約4,000行）をネイティブ ES
  Modules に分解（`src/static/modules/` 約25ファイル + `src/static/lib/`）。
  ビルドステップは導入していない（zero-build を維持）。
- CLI (`bin/mdv.js`) を `src/cli/` 配下のテスト可能なモジュール群
  （`registry`/`config`/`convert`/`resolveTarget`/`serverRegistry`/`errors`）
  に分解。`bin/mdv.js` はサブコマンドへの dispatch と `process.exit()` のみ
  を担う薄いエントリーポイントに。
- Playwright による E2E スモークスイート（`npm run test:e2e`）と GitHub
  Actions CI を追加。`npm test` / `npm run test:e2e` / `npm run lint` が
  すべて PASS/クリーンであることが以降のマージ条件。

## [0.5.22] - 2026-06-02

### Fixed — 大量のファイル/フォルダがあるディレクトリで開くとタブが固まる

ファイル数の多いディレクトリ（例: Downloads、サブフォルダが多いルート）で
mdv を開く、あるいは開いている間に一括 FS 操作（git checkout / npm install /
一括保存）が走ると、ブラウザタブが固まることがあった。原因はすべてブラウザ側の
左ファイルツリーの再描画（サーバー側は無罪）。2 系統あった:

- **イベント storm**: FS イベントごとに `tree_update` を連発し、クライアントが
  そのたびにツリーを全再構築していた。
- **一括描画**: 1 ディレクトリの大量エントリ、および初回ロードの先読み
  （lookahead）で大量の DOM ノードを一度に生成していた。

修正:

- **storm 抑制**: クライアントの `tree_update` を 1 回の refresh に集約
  （in-flight + dirty で直列化、古いレスポンスの上書き競合も解消）。watcher の
  broadcast を 150ms デバウンス。`POST /api/file` はファイル新規作成時のみ
  `tree_update` を送る（既存ファイル保存ではツリーを更新しない）。
- **ディレクトリ上限 + 遅延ページング**: 1 ディレクトリあたり 500 件で打ち切り、
  「もっと読み込む」で残りを `GET /api/tree/page` から取得。
- **先読み廃止**: `/api/tree` は最上位のみを返し、各フォルダは展開時に遅延
  ロード。どの形のフォルダでも初回オープンの DOM ノード数を最大 1 段（~500 行）
  に固定（サブフォルダ多数ルートで実測 60,206 → 166 ノード）。
- **差分描画**: ツリーを innerHTML で全破棄せず、パス + 種別キーで差分 reconcile。
  外部変更時もスクロール位置・展開状態・選択を維持。ロード済み（折りたたみ含む）
  および load-more 済みのディレクトリは、表示中の範囲を再取得して反映。
- **deep-link reveal**: cap を超える位置のエントリへ URL/リンクで遷移した際も、
  親をページングして当該ノードを reveal + ハイライト。

302 テスト全 PASS。Codex (GPT-5.5) 異種モデルクロスレビュー済み。

## [0.5.21] - 2026-05-22

### Fixed — Marp スライドが横長ペインで上下に見切れる

ウィンドウ表示（split モード）で、スライドペインがスライドのアスペクト比
（16:9）より横長になると、スライド（特に全面画像）の上下が見切れていた。

- 原因: スライドペイン内の `.marpit` に確定した高さがなく、active SVG の
  `max-height: 100%` が無効化されていた。SVG が「幅 100%」だけで決まるため、
  ペインが 16:9 より横長だと縦にあふれて上下がクリップされていた
  （フルスクリーン表示は `.marpit` が `height: 100vh` を持つため影響なし）。
- 修正: `.marpit` に `height: 100%` を与え、active SVG を
  `width/height: auto` + `max-width/height: 100%` の真の "contain" に変更。
  ペインが横長・縦長どちらでもスライド全体が必ず収まる。

### Added — トラックパッドのピンチズーム / パン

Marp スライド表示で、トラックパッドのピンチ操作（macOS では ctrl+wheel、
マウスの ctrl+スクロールも同様）でスライドを拡大・縮小できるように。

- 二本指スクロールでパン（ペインのネイティブ overflow スクロール）。ピンチと
  パンは分離（ctrl 付き wheel のみズーム）。
- カーソル位置を中心にズーム。ズーム範囲は fit（等倍）〜6倍。
- ダブルクリック / `0` キーで全体表示（fit）に復帰。`=` / `-` キーでも増減。
- スライド送り・フルスクリーン切替・ペインのリサイズで自動的に fit に追従。
- ズーム計算（contain fit / クランプ / wheel→zoom）は DOM 非依存の
  `src/static/lib/marpZoom.js` に分離し、単体テスト（`tests/test-marp-zoom.js`、
  12 件）を追加。

## [0.5.20] - 2026-05-18

### Fixed — Presenter View のノート編集が毎回 STALE エラー

Presenter View で speaker note を編集すると、毎回一瞬
`保存失敗: STALE — file changed externally; please reload`（赤）が出る
バグを修正。同じ deck を mdv のタブ/ウィンドウで 2 つ以上開いていると
必ず発生していた。

- 原因: Presenter View はノート保存を自前で行わず、`BroadcastChannel` の
  `edit-note` メッセージで **メインウィンドウに保存を委譲** する。この
  メッセージは同一ブラウザの **全メインウィンドウ** に届くため、deck を
  複数ウィンドウで開いていると **全員が同じ `If-Match` で PUT** し、サーバの
  楽観ロックで 1 つだけ成功、残りが 412 STALE になっていた。負けた側が
  `note-saved {ok:false, STALE}` を Presenter にブロードキャストし、赤い
  エラー表示になっていた（保存自体は 1 つ成功するため「一瞬だけ」見える）
- 各メインウィンドウに一意な `windowId` を付与。`slides` メッセージに
  `sourceWindowId` を載せ、Presenter は最初に deck を返したウィンドウを
  saver として固定、`edit-note` に `targetWindowId` を載せて **その 1
  ウィンドウだけが保存** するようルーティング
- saver ウィンドウが閉じた/凍結した場合は保存タイムアウト（6 秒）で
  検知し、`find-saver` 問い合わせで deck を持つ別ウィンドウ（非アクティブ
  な背景タブ含む）を探して再ピン・再送するフェイルオーバーを実装
- 各 `edit-note` に一意な `requestId` を付与し `note-saved` で echo。
  古い保存の ack が新しい保存のフェイルオーバー監視を誤って解除する問題を
  防止
- `saveNote` が「対象 Marp タブなし」のとき `note-saved` をブロードキャスト
  せず return していたため Presenter が `保存中…` のまま固まり得た問題も
  併せて修正（`code:'NO_DECK'` を返してフェイルオーバーを誘発）

### Verified

- 既存 278 + 新規 3（`tests/test-presenter-channel.js`: `newWindowId` の
  一意性 / フォールバック / モジュール API）
- Playwright dogfood: メインウィンドウ 2 枚 + Presenter で speaker note を
  編集 → STALE が出ないこと、メインウィンドウ 1 枚で回帰がないことを実機確認

## [0.5.19] - 2026-05-16

### Fixed — Marp `![bg]` background images

Marp の `![bg](画像)` 背景画像構文を含むスライドが mdv で真っ白になっていた
バグを修正。NotebookLM 製の図解 13 枚を `![bg]` で全面配置したプレゼンが mdv
で全スライド空白になり発覚（157_イディアコーポレーション案件）。

- 原因: marp-core は `![bg]` を `<img>` ではなく
  `<figure style="background-image:url(&quot;パス&quot;)">` として出力する。
  `rewriteMediaPaths` は `<img>/<video>/<audio>/<source>` の `src` 属性しか
  `/raw/` に書き換えず、CSS の `background-image:url(...)` を素通ししていた。
  結果、相対パスが SPA の現在 URL 基準で誤解決され 404 → CSS 背景画像のため
  コンソールエラーも出ず真っ白になっていた
- `rewriteMediaPaths` に `background-image:url(...)` 書き換えルールを追加。
  marp-core が HTML エンコードするクォート（`&quot;`）に対応
- quoted URL は **対応する閉じクォートまで** を URL として読む。最初の `)` で
  切らないため、`cover (1).png` のような括弧入りファイル名
  （Marp 出力 `url(&quot;cover%20(1).png&quot;)`）も壊れない
- 絶対 URL・data URI・空 URL は書き換えない
- 既知の制約: 1 つの `background-image:` 宣言に複数 `url()` がある場合は先頭
  のみ書き換わる。`![bg]` は 1 枚ごとに別 `<figure>` になるため影響なし。
  カンマ区切りの `backgroundImage:` ディレクティブのみのエッジケース

### Verified

- 278 テスト 全 PASS（既存 272 + 新規 6: `![bg]` 相対/サブディレクトリ/括弧/
  エンコード空白/空/絶対 URL）
- Playwright dogfood（`docs/dogfood_20260516/`）: 全面 bg / bg fit / split bg /
  インライン画像 / 絶対 URL bg / サブディレクトリ解決の 6 ケースを実機目視、
  コンソールエラー 0
- Codex review 3 round（codex-loop）で収束。round 1 [P2] 括弧切れ修正、
  round 2 [P3] 空 URL ガード、round 3 [P3] 複数 url 制約を文書化

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
