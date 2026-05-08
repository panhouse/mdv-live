# Refactor Plan: DRY + SOLID 根本治療

> 9 サブエージェント並列監査で出た約 30 件を集約。対症療法ではなく
> 「重複源を 1 つに集約」「責務をモジュールで分割」「I/O 境界を抽象化」
> という構造的修正で恒久解決する。

## 1. 現状の構造的問題（症状ではなく原因）

| 原因 | 症状（agent 指摘） |
|---|---|
| 共通エラー処理が無い | mkError×4 重複、code→status マッピング散在、reason 文字列不統一 |
| Marp engine 直結を許容している | `marp.js` と `marpitAdapter.js` で別 Marp instance、isMarp 重複 |
| HTTP handler に責務集中 | PUT handler 140行、validation/lock/IO/parse/rewrite/response 全部 inline |
| HTTP client 抽象が無い | `app.js` に fetch 13 箇所散在 |
| BroadcastChannel が両側ハードコード | チャンネル名・message schema が暗黙、変更耐性ゼロ |
| mutex が naive Map | thundering-herd で待機者 ≥2 で崩壊 → P1 race |
| PresenterView God object | UI/SaveQueue/HTTP/状態管理 8 責務 |
| Tab life-cycle hook 不在 | 切替時の reset、close 時の cleanup が漏れ → メモリリーク |

## 2. 設計原則（再宣言）

1. **Single Source of Truth (SSOT)**: 同じ概念は 1 箇所だけ。Marp engine、isMarp、ETag、エラーコード分類、BroadcastChannel name。
2. **責務 1 モジュール 1 役割**: HTTP handler は orchestration のみ。I/O は別モジュール。
3. **境界に抽象を置く**: HTTP / FS / BroadcastChannel / Marp engine の 4 境界に
   port を作り、テスト時に置換可能にする。
4. **State life-cycle を明示**: タブの open / switch / close で必要な reset/cleanup を 1 箇所で。
5. **エラーは type-safe**: `mkError(code, ...)` で生成、`ERROR_STATUS_MAP[code]` で
   HTTP status 決定、文言は code → message 辞書から。

## 3. リファクタ範囲

### 3.1 新規モジュール

| ファイル | 役割 | 集約する重複源 |
|---|---|---|
| `src/utils/errors.js` | `mkError` / `ERROR_STATUS_MAP` / `sendError` / clientReasonOf | mkError×4、status 散在、reason 不統一 |
| `src/utils/etag.js` | `makeEtag(rawSource)` | rendering/index.js + api/marpNote.js の重複 |
| `src/concurrency/pathLock.js` | promise-chain 化した正しい mutex | naive Map mutex → thundering-herd race |
| `src/api/middleware/originGuard.js` | Origin/Host/SFS 検証 | GET/PUT/OPTIONS で 3 重複 |
| `src/api/middleware/jsonGuard.js` | Content-Type 厳密チェック + body schema | inline ad-hoc check |
| `src/api/marpNote/readDeck.js` | path 解決 → open(O_NOFOLLOW) → stat → read | 重複 try/catch ブロック |
| `src/api/marpNote/handleGet.js` | GET orchestration のみ | PUT handler から責務分離 |
| `src/api/marpNote/handlePut.js` | PUT orchestration のみ | 同上 |
| `src/static/lib/apiClient.js` | `getDeck/saveNote/...` (fetch 抽象) | app.js の fetch 13 箇所 |
| `src/static/lib/presenterChannel.js` | チャンネル名 + message schema + JSDoc typedef | app.js + presenter.html ハードコード |
| `src/static/lib/saveQueue.js` | per-deck coalesce queue (純 JS) | PresenterView から分離、unit testable |
| `src/static/lib/tabRegistry.js` | tab open/switch/close hooks | PresenterView ↔ saveQueue/lastSavedEtag/cleanup |

### 3.2 既存モジュールの整理

| ファイル | 変更 |
|---|---|
| `src/rendering/marpitAdapter.js` | 唯一の Marp instance。`isMarp` SSOT。`countLines` を `lineMath.js` に移動 (re-export 維持) |
| `src/rendering/marp.js` | `marpitAdapter.renderDeck` を呼ぶだけにし、Marp instance を削除 |
| `src/rendering/markdown.js` | `isMarp` を marpitAdapter から re-export |
| `src/api/marpNote.js` | `setupMarpNoteRoutes` のみ残す。実装は `marpNote/` 配下へ |
| `src/utils/atomicWrite.js` | `writeTmp / restoreOwnership / commitRename` の 3 関数に分割。`sweepStaleTemps` は `tempSweeper.js` へ |
| `src/static/app.js` | PresenterView から SaveQueue / API / TabRegistry を分離 |
| `src/static/presenter.html` | `<script>` 内を `presenterChannel`/`noteEditor`/`slideRenderer`/`layoutResizer` の 4 関数 IIFE に分割 |

### 3.3 削除

- `src/rendering/marp.js` 内の `new Marp(...)` (重複)
- `src/static/marpNoteRewriter.js` (既に削除済み、再確認)

## 4. P1 修正詳細

### 4.1 `withPathLock` race (concurrency #1)

**現状の問題**:
```js
async function withPathLock(realPath, fn) {
  while (pathLocks.has(realPath)) {
    try { await pathLocks.get(realPath); } catch {}
  }  // ← 複数の待機者が同時に再チェックして false を観測 → 並列実行
  let resolve;
  const wait = new Promise((r) => { resolve = r; });
  pathLocks.set(realPath, wait);
  ...
}
```

**修正 (promise-chain)**:
```js
// src/concurrency/pathLock.js
const locks = new Map();

export async function withPathLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  // Chain: this fn runs only after the previous promise resolves.
  const result = previous.then(fn, fn);
  locks.set(key, next);
  try {
    return await result;
  } finally {
    release();
    if (locks.get(key) === next) locks.delete(key);
  }
}
```

これで N 個の待機者が来ても全員前の promise の `then` chain に並ぶ → 必ず直列。

### 4.2 `mkError` / error mapping 統合

```js
// src/utils/errors.js
export const ERROR_STATUS = Object.freeze({
  PATH_INVALID: 403,
  NOT_FOUND: 404,
  NOT_MARP: 400,
  OUT_OF_RANGE: 400,
  INVALID_NOTE: 400,
  MULTI_NOTE_READONLY: 409,
  STALE: 412,
  IF_MATCH_REQUIRED: 428,
  PAYLOAD_TOO_LARGE: 413,
  ORIGIN_REJECTED: 403,
  READONLY: 403,
  NOT_PARSEABLE: 500,
  WRITE_FAILED: 500,
  READ_FAILED: 500,
  NETWORK_ERROR: 0       // client-only
});

export function mkError(code, message, opts = {}) {
  const err = new Error(message || code);
  err.code = code;
  if (opts.cause) err.cause = opts.cause;
  return err;
}

export function sendError(res, err) {
  const code = err.code || 'WRITE_FAILED';
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({
    ok: false,
    code,
    error: err.message || code,
    ...(err.currentEtag ? { currentEtag: err.currentEtag } : {})
  });
}
```

全モジュールがこれを import。
GET の read 失敗は `READ_FAILED` (新設) にする (現状 WRITE_FAILED 流用は誤り)。

### 4.3 `isMarp` SSOT

`marpitAdapter.js` が唯一の定義。`markdown.js` は `export { isMarp } from './marpitAdapter.js'` で再 export。

### 4.4 PUT handler 分割

```js
// src/api/marpNote/handlePut.js
export async function handlePutSlideNote(req, res, ctx) {
  const guards = [validateOriginHost, validateContentType, validateIfMatch,
                  validateSlideIndex, validateNoteBody];
  for (const g of guards) {
    const err = g(req, ctx);
    if (err) return sendError(res, err);
  }
  const rel = req.params.encodedPath;
  const earlyDeck = await readDeckSafely(ctx.rootDir, rel).catch(toError);
  if (earlyDeck.error) return sendError(res, earlyDeck.error);
  return withPathLock(earlyDeck.realPath, () =>
    performNoteUpdate(req, res, ctx, rel, earlyDeck));
}
```

`performNoteUpdate` は: re-read → ETag check → parseDeck → rewrite → realpath check → atomicWrite → respond。各ステップは小さい関数。

## 5. P2 修正詳細

### 5.1 PresenterView 分割

```js
// src/static/lib/saveQueue.js  (pure, jsdom 不要)
export class SaveQueue {
  constructor({ saveFn, getOwnEtag }) { ... }
  enqueue(path, slideIndex, note, etag) { ... }
}

// src/static/lib/apiClient.js
export const ApiClient = {
  getDeck(path) { ... },
  saveNote(path, slideIndex, note, ifMatch) { ... },
  // … 既存 fetch も全部
};

// src/static/lib/presenterChannel.js
export const CHANNEL_NAME = 'mdv-marp-presenter';
/** @typedef {{type:'slides', path, html, css, etag, notes, notesMultiplicity, current}} SlidesMsg */
/** @typedef {{type:'goto', index}} GotoMsg */
// ... 全 6 種

// src/static/app.js (PresenterView simplified)
const PresenterView = {
  channel: null, presenterWindow: null, saveQueue: null,
  init() {
    this.channel = createPresenterChannel();
    this.saveQueue = new SaveQueue({
      saveFn: ApiClient.saveNote,
      getOwnEtag: (path) => this.lastSavedEtag.get(path),
    });
    this.channel.on('edit-note', (msg) =>
      this.saveQueue.enqueue(msg.path, msg.slideIndex, msg.note, msg.etag));
    // ...
  },
  // 30 行に減る
};
```

### 5.2 Tab life-cycle hooks (`tabRegistry.js`)

```js
export const tabRegistry = {
  onOpen: [], onSwitch: [], onClose: [],
  registerOnClose(fn) { this.onClose.push(fn); }
};

// PresenterView init で:
tabRegistry.registerOnClose((path) => {
  this.saveQueue.dropPath(path);
  this.lastSavedEtag.delete(path);
});
```

TabManager.closeTab で `tabRegistry.onClose.forEach(fn => fn(path))` を呼ぶ。

### 5.3 STALE UX 改善

`note-saved` の reason に `code: 'STALE'` を含め、presenter は code 専用辞書で
日本語文言と「編集内容を退避しました」+ コピーボタンを表示。
編集中のテキストは localStorage にバックアップ保存。

### 5.4 Tab 切替時の presenter reset

`broadcastSlides` 内、`tab.isMarp` でない場合に `{ type: 'slides', empty: true }` を
明示的に送信。presenter は empty-state UI に戻し、保存無効化。

### 5.5 placeholder の罠

`:empty::before { content: '（ノートなし）' }` で CSS pseudo-element 化。
テキストノードを使わないので「placeholder が note 本文として保存される」事故を構造的に消す。

## 6. P3 修正詳細

### 6.1 命名統一

| 旧 | 新 |
|---|---|
| `notesMultiplicity` | `notesPerSlide` (count) |
| `commentsBySlide` | `commentTokensBySlide` |
| `classifiedNotes` | `noteStringsBySlide` |
| `noteComments` | `noteTokens` |
| `running` (queue) | `isDraining` |
| `editing` | `isEditingNote` |
| `changed` | `didChange` |
| `degraded` | `isReadOnly` |

### 6.2 CHANGELOG / README 更新

- CHANGELOG: 0.5.7 として「Marpit-token-based note autosave / Multi-note Guard / ETag optimistic locking / per-path mutex」
- README: Features に「Presenter View でのスピーカーノート自動保存」追記

### 6.3 Plan 修正

`PLAN-marpit-note-rewriter.md` を実装に合わせて microscopic に追記:
- `tmp` 名 format: `.~mdvtmp.<pid>.<rand>.<base>` (実装に合わせる)
- SaveQueue 構造: per-path Map (Plan §5.9 の per-(path,slideIndex) は内部表現に集約)
- watcher ignore は dotfile rule で吸収 (明示パターンは追加しない)

## 7. テスト追加

| テスト | 優先度 |
|---|---|
| Parallel PUT mutex 確認 | high |
| `withPathLock` thundering-herd 単体 | high |
| Sec-Fetch-Site Origin null 受理パス | medium |
| Watcher broadcast に etag が乗る | medium |
| SaveQueue 単体 (coalesce / drain) | medium |
| EXDEV fallback (mock) | low |

## 8. 実装フェーズ

| Phase | 内容 | 目安 |
|---|---|---|
| R1 | utils/errors.js + utils/etag.js + 全 import 切替 | 60 min |
| R2 | concurrency/pathLock.js + race fix + テスト | 60 min |
| R3 | api/marpNote/ 分割 + middleware 抽出 | 90 min |
| R4 | static/lib/{apiClient,presenterChannel,saveQueue,tabRegistry}.js | 120 min |
| R5 | PresenterView slim 化 + tab close cleanup | 60 min |
| R6 | UX: STALE バナー / Tab 切替 reset / placeholder CSS / resize gutter | 90 min |
| R7 | 命名統一 (機械置換 + manual review) | 30 min |
| R8 | テスト追加 (parallel PUT / SaveQueue 単体 / Sec-Fetch-Site / etag broadcast) | 90 min |
| R9 | CHANGELOG / README / Plan 整合 | 30 min |
| R10 | codex-loop で再検証 | 60 min |
| R11 | /dev-security 実行 | 60 min |
| R12 | /dogfood-ui 実機 PASS/FAIL | 60 min |
| R13 | 0.0.1 bump + 最終コミット | 15 min |

合計 ~14 時間。

## 9. 非ゴール

- API endpoint 名の変更（互換性破壊）
- BroadcastChannel → WebSocket への切り替え（同一マシン同タブで十分）
- ノート編集 UI の DOM 仮想化（slide 数 1000 でも 86 ms なので不要）
- 多言語化（日本語 only で良い、現状 UI は日本語）

## 10. 成功基準

- [ ] `mkError` の重複定義が 0
- [ ] エラー code → status マッピングが 1 箇所
- [ ] PUT handler の関数本体が < 30 行
- [ ] PresenterView の関数本体が < 200 行
- [ ] fetch 直叩きが `apiClient.js` 以外で 0
- [ ] `BroadcastChannel('mdv-marp-presenter')` リテラルが 1 箇所
- [ ] mutex thundering-herd 単体テスト PASS
- [ ] codex-loop が 0 round で指摘なし or 1〜2 件 minor
- [ ] /dev-security の P1/P2 が 0
- [ ] /dogfood-ui の主要シナリオがすべて PASS
- [ ] テスト 222 → +20 件以上
- [ ] バージョン 0.5.6 → 0.5.7 (semver patch+)
