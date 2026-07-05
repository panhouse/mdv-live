# Plan v5: Marpit-token-based note rewriter (FINAL)

> Round 4 review (3視点 11件、minor patches のみ) を反映した v5、最終版。
> Round 1→2→3→4 で 21→23→14→11 と収束。Round 4 は API shape の明示、
> Multi-note Guard のサーバ側強制、SaveQueue 例外時 finally など実装ガイダンス
> レベルの指摘で、設計上の根本問題は無し。3視点とも「実装可能な粒度に達して
> いる」と評価し、本 plan を **計画完成版** とする。
>
> v3 → v4 の主要変更:
> - **PNA は明示拒否** に統一（§4.3 と §5.7 の論理矛盾を解消）
> - **Origin + Sec-Fetch-Site の二重判定** (Safari/file:// 履歴差吸収)
> - **multi-note ファイルは UI を read-only に degrade**（先頭 note 消失防止）
> - **SaveQueue superseded semantics 明記**（上書き古 promise の扱い）
> - **retry は per-(path, slideIndex) で連続 STALE 3 回上限**（無限ループ防止）
> - **GET degrade 時は etag を返さない**（UI を物理的に保存不可に）
> - **lineStarts と BOM の関係を再定義**（splice 開始 byte index を厳密化）
> - **O_NOFOLLOW は best-effort と明記**（中間 dir symlink 攻撃は realpath に委任）
> - **NFS/btrfs/exFAT で dev/ino が揺れるケースは警告ログのみで通過**
> - **sweep は uid 自分 + mtime > 1h のみ**（他ユーザ tmp に触らない）
> - **`marpit_comment` の事前 directive フィルタ** で zip 誤マッチを防ぐ
> - **EXDEV fallback を 2 段 rename** で atomicity 保持
> - **chmod 握りつぶしは EPERM/ENOTSUP のみ**
> - **`.~mdvtmp.<pid>.<rand>` + `O_EXCL` で衝突排除**
> - **coalescing 単位 (path, slideIndex)** + queue 上書きで最新値必ず処理
> - **見積もりを 16〜18h に修正**（v3 の 12h は楽観的）

## 1. 目的

Marp スピーカーノート編集の自動保存を、Marp 自身の構造に沿って実装する。
v0 (regex) は Marp 仕様を JS で再実装しており毎ラウンド edge case が湧く構造。
本案は **Marpit のパーサ出力 (token + comments)** を介して slide 範囲と
note 位置を特定し、surgical splice で書き戻す。

ただし **splice / 順序 zip / 行↔バイト変換は依然自前**。それらを純関数 + 契約
テストで凍結し、Marpit の API 変更にだけ追従すれば済む形にする。

## 2. v0 (regex 実装) の構造的問題

毎回手で追従が必要:
- 区切り: `---` / `***` / `___` / setext H2 / fenced code 内除外
- headingDivider: scalar / inline-array / block-array / コメント形式
- Directive whitelist: `lang` / `transition` / 未知 key
- 先頭 directive vs 先頭 note の扱い
- フェンス内 directive 風コメントの無視

未対応 edge case:
- YAML block-form `headingDivider:\n  - 1`
- headingDivider モードで先頭が note コメント
- inactive presenter での外部編集 race

## 3. アーキテクチャ

### 3.1 設計原則

1. **Marp の事実は Marp に聞く**: token と `render().comments` を解釈の唯一の source。
2. **API 境界を明示**: Marpit の internal を直接触らない。`MarpitTokenAdapter`
   1箇所に依存を集約し、契約テストで凍結。
3. **書き換えは保守的**: 編集対象 slide 外は **byte 完全一致** を不変条件に。
4. **同時編集は楽観ロック**: ETag (rawSource hash) を req/res に同梱。
   mutex / TOCTOU / inactive race / 外部編集 race を一括解決。
5. **client は薄く**: 書き換えロジックは server 集中、client は fetch のみ。
6. **CSRF は Origin+Host で防御**（トークン廃止、XSS 配布リスク回避）。

### 3.2 データフロー

```
[Presenter] edit-note ─BroadcastChannel─▶ [Main]
                                            │
                                            ▼
                                  PUT /api/marp/decks/{path}/slides/{N}/note
                                  If-Match: <etag>
                                  Origin: http://localhost:<port>
                                            │
                                            ▼
                                  [Server: marpNoteWriter]
                                  ├─ Origin / Host 検証
                                  ├─ validatePathReal
                                  ├─ open(O_NOFOLLOW) → fstat (dev/ino 保持)
                                  ├─ readFile (open fd)
                                  ├─ ETag 一致確認 → 不一致は 412
                                  ├─ MarpitTokenAdapter.parseDeck()
                                  ├─ rewrite() → newSource + newEtag
                                  ├─ atomic write (権限保持, EXDEV 2段)
                                  └─ 最終 lstat で dev/ino 一致確認
                                            │
                                            ▼
                                  watcher → WebSocket {path, etag, notes}
                                  → main の tab.etag/notes 更新
                                  → broadcastSlides {etag}
                                  → presenter.deckEtag 更新
```

### 3.3 「Marp に委譲する」の正直な範囲

| カテゴリ | v0 (regex) | v3 (token) |
|---|---|---|
| 区切り検出 | 自前 regex | **token 委譲** |
| comment 抽出 | 自前 regex | **token 委譲** |
| directive 判定 | 自前 whitelist | **`render().comments` で除外確認 + 事前フィルタ** |
| Marpit API 依存 | なし | **adapter 層で隔離 + 契約テスト** |
| splice ロジック | あり | **あり (薄い、純関数)** |
| 改行/BOM/UTF-8境界 | 各所で対応 | **専用ヘルパに集約** |
| `marpit_comment.content` の trim 規則 | 関係なし | **片側 trim と契約テストで凍結** |
| classifiedNotes との照合 | 関係なし | **content 等価 zip + 個数 assert** |

「Marp parser を再実装する苦行」からは脱出する。ただし **adapter / splice /
zip は依然自前**。指摘の通り「委譲したから根本治療」は誇大なので、本表を
正直版とする。

## 4. API 契約

### 4.1 GET /api/marp/decks/:encodedPath

レスポンス:
```json
{
  "ok": true,
  "etag": "sha256:<hex>",
  "encoding": "utf-8",
  "lineEnding": "\n",
  "hasBom": false,
  "slideCount": 37,
  "notes": ["...", "..."],
  "notesMultiplicity": [1, 0, 2, 1, ...]
}
```

`Cache-Control: no-store` 必須。`notesMultiplicity[i]` はスライド i の
speaker note 個数（Multi-note Guard 用）。

### 4.2 PUT /api/marp/decks/:encodedPath/slides/:slideIndex/note

リクエスト:
```
PUT /api/marp/decks/%E8%B3%87%E6%96%99%2Fseminar.md/slides/4/note
Origin: http://localhost:8642
Host: localhost:8642
If-Match: sha256:abc123...
Content-Type: application/json
Body: { "note": "..." }
```

レスポンス (成功):
```json
{
  "ok": true,
  "etag": "sha256:def456...",
  "normalizedNote": "...",
  "slideCount": 37
}
```

レスポンス (失敗):
```json
{ "ok": false, "code": "STALE", "currentEtag": "sha256:..." }
```

エラーコード:
| code | HTTP | 状況 |
|---|---|---|
| `ORIGIN_REJECTED` | 403 | Origin/Host が許可リスト外 |
| `PATH_INVALID` | 403 | 経路 / symlink 違反 |
| `NOT_FOUND` | 404 | ファイルなし |
| `NOT_MARP` | 400 | Marp ファイルでない |
| `OUT_OF_RANGE` | 400 | slideIndex 範囲外 |
| `INVALID_NOTE` | 400 | `-->` / `--!>` / 末尾 `--` / size 超過 |
| `MULTI_NOTE_READONLY` | 409 | 対象 slide が複数 note を含むため自動保存不可 |
| `STALE` | 412 | If-Match 不一致 |
| `IF_MATCH_REQUIRED` | 428 | If-Match 欠落 |
| `READONLY` | 403 | 書き込み権限なし |
| `PAYLOAD_TOO_LARGE` | 413 | body > 128KB |
| `NOT_PARSEABLE` | 500 | adapter 契約破綻（degrade して GET は動く） |
| `WRITE_FAILED` | 500 | I/O / atomic 失敗 |

専用 error handler でエラーは `{ ok: false, code, error }` 形に正規化。
**stack trace を返さない**。`error` は固定文言の whitelist。

### 4.3 PNA / preflight (拒否方針)

PNA (Private Network Access) preflight は **拒否**で統一。public→private 文脈は
Origin が外部サイトになり Origin チェック (§5.7) で 403 となる。本機能は
localhost 同一オリジン以外には CORS を開けない、を明示する。

`OPTIONS` に対して:
- 同じ Origin/Host/Sec-Fetch-Site チェック
- 一致時: `Access-Control-Allow-Methods: GET, PUT, OPTIONS`
        `Access-Control-Allow-Headers: Content-Type, If-Match`
- 不一致時: 403 ORIGIN_REJECTED
- `Access-Control-Request-Private-Network: true` でも `Allow-Private-Network`
  は **返さない**（Chrome 130+ で localhost ターゲット PNA preflight が必須化
  しても、本 API は同一オリジン使用前提なので影響なし）

### 4.4 入力バリデーション

| 項目 | 制約 |
|---|---|
| `Origin` | `http://localhost:<port>` または `http://127.0.0.1:<port>` |
| `Sec-Fetch-Site` | `same-origin` を要求（Origin が `null` でも fetch 経路ならこちらで判定） |
| `Origin` 受理条件 | (A) Origin が許可ホスト一致 OR (B) Origin 欠落 + Sec-Fetch-Site=`same-origin` |
| `Host` | 許可ホスト部一致 |
| `Content-Type` | `application/json` 厳密一致（simple-request 経路を物理的に塞ぐ） |
| `encodedPath` | URL decode 後、`validatePathReal` で rootDir 内 |
| `slideIndex` | path param、`Number.isInteger` で 0 ≤ N < 1000 |
| `note` | `string`、UTF-8、≤ 64 KiB、`-->` / `--!>` / 末尾 `--` / NUL を含まない |
| Body 全体 | `express.json({ limit: '128kb' })`、超過は 413 専用ハンドラで正規化 |
| Object | `Object.create(null)` ベースで parse、`hasOwn` のみ参照 |

## 5. サーバ実装

### 5.1 ファイル構成

新規:
- `src/rendering/marpitAdapter.js` — Marpit API 1箇所ラップ + 契約テスト
- `src/rendering/marpNoteWriter.js` — splice ロジック
- `src/utils/lineMath.js` — 行↔バイト変換 + BOM/CRLF ヘルパ
- `src/utils/atomicWrite.js` — atomic file write + 権限保持 + EXDEV 二段
- `src/api/marpNote.js` — GET / PUT / OPTIONS

修正:
- `src/server.js` — `setupMarpNoteRoutes(app)`、Origin/Host 検証ミドル
- `src/api/file.js` — Marp 応答に `etag` / `lineEnding` / `hasBom` 追加
- `src/watcher.js` — `.~mdvtmp.*` を ignored、broadcast に `etag` 同梱
- `src/static/app.js` — Presenter, `tab.etag` 管理、saveNote を fetch に

削除:
- `src/static/marpNoteRewriter.js`
- `tests/test-marp-note-rewriter.js`

### 5.2 MarpitTokenAdapter

責務: **Marpit から得られる「事実」を 1 箇所で形成し、契約テストで凍結する**。
区切り計算と note コメント特定はすべてここ経由。

```js
// src/rendering/marpitAdapter.js
export function parseDeck(rawSource) {
  const env = {};
  const tokens = marp.markdown.parse(rawSource, env);
  const { comments: classifiedNotes } = marp.render(rawSource);

  const slideOpens = tokens.filter((t) => t.type === 'marpit_slide_open');
  for (const t of slideOpens) {
    if (!t.map) throw mkError('NOT_PARSEABLE', 'slide_open without map');
  }
  const slideStartLines = slideOpens.map((t) => t.map[0]);

  const totalLines = countLines(rawSource);
  const slideRanges = slideStartLines.map((start, i) => ({
    startLine: start,
    endLine: i + 1 < slideStartLines.length ? slideStartLines[i + 1] : totalLines
  }));

  // marpit_comment を slide ごとに集約。directive を事前フィルタ:
  // marpit が directive と判定したものは classifiedNotes に出ない。
  // よって「同 slide 内の marpit_comment のうち classifiedNotes[i] に出る
  // 値だけを順序 zip でマッチ、残りは directive とみなす」方針。
  const commentsBySlide = slideRanges.map(() => []);
  let cursor = -1;
  for (const t of tokens) {
    if (t.type === 'marpit_slide_open') {
      cursor = slideStartLines.indexOf(t.map[0]);
    } else if (t.type === 'marpit_comment' && cursor >= 0) {
      if (!t.map) throw mkError('NOT_PARSEABLE', 'comment without map');
      commentsBySlide[cursor].push({
        content: t.content, // **片側 trim 仕様**（契約テストで凍結）
        startLine: t.map[0],
        endLine: t.map[1]
      });
    }
  }

  // Multi-note Guard 用: 各 slide のスピーカーノート個数
  const notesMultiplicity = classifiedNotes.map((arr) => (arr || []).length);

  return {
    slideCount: slideRanges.length,
    slideRanges,
    classifiedNotes,
    commentsBySlide,
    notesMultiplicity
  };
}

export function pickNoteComments(commentsInSlide, noteStrings) {
  // 順序 zip + count assert:
  // - commentsInSlide を順に走査し、`content === noteStrings[cursor]` のものを
  //   note とみなして cursor++。
  // - 末尾で cursor !== noteStrings.length なら NOT_PARSEABLE。
  const notes = [];
  let cursor = 0;
  for (const c of commentsInSlide) {
    if (cursor < noteStrings.length && c.content === noteStrings[cursor]) {
      notes.push(c);
      cursor++;
    }
  }
  if (cursor !== noteStrings.length) {
    throw mkError('NOT_PARSEABLE', 'comments mismatch with classifiedNotes');
  }
  return notes;
}
```

**契約テスト (`tests/test-marpit-adapter.js`)**:
- `marpit_slide_open.map` の形が `[startLine, endLine]` (snapshot)
- `marpit_comment.content` が **左空白を保持し右空白だけ trim** される (snapshot)
- `marpit_slide_close.map` は null になり得る (snapshot)
- BOM 付き入力で `slide_open.map[0]` が 0 で出る (snapshot)
- headingDivider の各形式 (scalar/inline-array/block-array/comment) で
  期待 slide 数を発行する (snapshot)

これらのいずれかが破れたら adapter は `NOT_PARSEABLE` で 500 を返し、
**API は GET だけ degrade して動く** (`notes: []`、UI は read-only 表示)。

### 5.3 splice ロジック (marpNoteWriter)

責務: parseDeck の結果を受けて純関数として splice する。
**ファイル I/O も Marpit API も触らない。**

```js
// src/rendering/marpNoteWriter.js
export function rewriteSlideNote(rawSource, slideIndex, newNote, parsed, lineInfo) {
  if (slideIndex < 0 || slideIndex >= parsed.slideCount) {
    throw mkError('OUT_OF_RANGE');
  }
  const reason = validateNoteText(newNote);
  if (reason) throw mkError('INVALID_NOTE', reason);

  const noteStrings = parsed.classifiedNotes[slideIndex] || [];
  const candidates = parsed.commentsBySlide[slideIndex];
  const noteComments = pickNoteComments(candidates, noteStrings);

  // Multi-note Guard をサーバ側で強制 (defense-in-depth):
  // client が `notesMultiplicity` を無視 / 改変して PUT してきても、
  // サーバ側で複数 note を検知したら 409 で拒否する。
  if (noteComments.length > 1) {
    throw mkError('MULTI_NOTE_READONLY',
      'slide has multiple speaker notes; auto-save disabled');
  }

  // ノート方針: **最後の既存 note を置換、他は維持**
  // （実際は Multi-note Guard で複数 note は弾かれるので、ここは
  // length === 0 or 1 のみが到達。「最後の」は length === 1 のときだけ意味を持つ）

  if (newNote.trim() === '') {
    if (noteComments.length === 0) return { source: rawSource, changed: false };
    return spliceRemove(rawSource, lineInfo, noteComments[noteComments.length - 1]);
  }

  const formatted = formatNoteComment(newNote, lineInfo.lineEnding);

  if (noteComments.length === 0) {
    const insertLine = findInsertionLine(parsed.slideRanges[slideIndex], lineInfo);
    return spliceInsertAtLine(rawSource, lineInfo, insertLine, formatted);
  }

  const last = noteComments[noteComments.length - 1];
  return spliceReplaceLines(rawSource, lineInfo, last, formatted);
}
```

#### 5.3.1 行↔バイト変換 (`src/utils/lineMath.js`)

- **BOM (U+FEFF) は rawSource[0] にそのまま残す**。lineStarts は通常通り
  `lineStarts[0] = 0` で計算するが、splice の際は **rawSource 全体を JS string
  として slice** するため、BOM を含む先頭は変えない限り保持される。
  marpit_comment.map[0] が 0 になるケース（先頭 directive）でも、コメント自体
  の splice 範囲は `lineStarts[map[0]]` から始まるが、**先頭が BOM のみの行は
  存在しない**（BOM は行0の文字列の先頭、map[0]=0 はその同じ行を指す）。
  契約テストで「BOM 入り入力 → splice 後も `rawSource[0] === '\\uFEFF'`」を凍結。
- 改行は LF / CRLF / CR の混在を検出し、**最頻種を `lineEnding` として記録**。
  既存改行は触らず、**新規挿入行のみ** `lineEnding` を使用。
- `lineStarts[i]` = i 行目（0-origin）の先頭の **JS string index**。
- splice はすべて JS string 上で行い、UTF-16 surrogate pair は string slice で
  破壊しない。書き出し時 `Buffer.from(s, 'utf-8')` で UTF-8 エンコード。
- `countLines(s)`: 末尾改行ありなら `lineCount = (s.match(/\\r\\n|\\r|\\n/g) || []).length`、
  末尾改行なしなら `lineCount = ... + 1`。markdown-it の `t.map` は 0-origin
  半開区間で「最終行が改行で終わる行」も 1 行としてカウントするので、本実装の
  `lineCount` と marpit の整合は契約テストで凍結する。
- `endsWithNewline = !!rawSource.match(/(?:\\r\\n|\\r|\\n)$/)` を保持し、書き戻し
  時に勝手に増やさない／減らさない。

#### 5.3.2 ノートコメント挿入位置 / 範囲

- **置換**: `noteComment.startLine` から `noteComment.endLine` までの全行を
  formatted で置換。`endLine` は marpit の慣例で「コメント終了行 + 1」なので、
  `[startLine, endLine)` の半開区間として扱う。**契約テストで凍結**。
- **挿入** (既存 note なし):
  - `findInsertionLine(range, lineInfo)`: `range.endLine - 1` から逆走査して
    最初の **非空行** を見つけ、その**次の行**を挿入位置にする。
  - 末尾 slide で `endLine === totalLines` の場合も同様に末尾の非空行直後に
    挿入。EOF 改行の有無は `lineInfo.endsWithNewline` で保持し、挿入で勝手に
    増やさない。
- **削除** (note 空): 該当 token の `[startLine, endLine)` を削除し、削除箇所の
  **直前 / 直後の空行 1 つまで**を吸収する（編集対象 slide 外には影響させない）。

#### 5.3.3 `INVALID_NOTE` 判定

- `-->`, `--!>`, 末尾 `--` を含む → 拒否
- size > 64 KiB → 拒否
- NUL 文字を含む → 拒否

#### 5.3.4 `formatNoteComment(text, lineEnding)`

- 単一行: `<!-- text -->`
- 複数行: 改行を `lineEnding` に揃え、`<!--<lineEnding>text<lineEnding>-->`

### 5.4 ETag (楽観ロック)

```js
function makeEtag(rawSource) {
  return 'sha256:' + crypto.createHash('sha256').update(rawSource).digest('hex');
}
```

PUT 時:
1. `If-Match` ヘッダ必須。無ければ 428 IF_MATCH_REQUIRED。
2. **fd 経由で読み込んだ rawSource の hash と If-Match を比較**。不一致なら
   412 + `currentEtag`。
3. 一致なら splice → 書き込み → newEtag 返却。

**broadcastFileUpdate に etag を含める** (5.8)。
client (`tab.etag`) は GET / WebSocket update / PUT 成功時に必ず更新される。

`ETag = sha256(rawSource)` は **書き込み時の rawSource をそのまま hash** する
ので、改行種別を勝手に変換していなければ常に一致する。client 側は受け取った
etag をそのまま If-Match に積むだけ。

### 5.5 atomic write + 権限保持 (`src/utils/atomicWrite.js`)

```js
export async function atomicWrite(fullPath, content, originalStat) {
  // originalStat: 呼び出し側が open 直後に取った fstat の結果
  if (originalStat && !isWritable(originalStat)) throw mkError('READONLY');

  const tmpPath = `${fullPath}.~mdvtmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  let tmpHandle = null;
  try {
    // O_EXCL で排他作成。同名衝突は EEXIST で即時失敗
    tmpHandle = await fs.open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await tmpHandle.writeFile(content, 'utf-8');

    // 権限復元: chmod 失敗のうち EPERM/ENOTSUP のみ握りつぶす
    if (originalStat) {
      try {
        await fs.chmod(tmpPath, originalStat.mode);
      } catch (e) {
        if (e.code !== 'EPERM' && e.code !== 'ENOTSUP') throw e;
      }
      try {
        await fs.chown(tmpPath, originalStat.uid, originalStat.gid);
      } catch (e) {
        if (e.code !== 'EPERM') throw e;  // chown は非 root で常に EPERM
      }
    }

    await tmpHandle.close();
    tmpHandle = null;

    // rename 試行。EXDEV 時は 2 段で
    try {
      await fs.rename(tmpPath, fullPath);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      const partPath = `${fullPath}.~mdvpart.${crypto.randomBytes(6).toString('hex')}`;
      try {
        await fs.copyFile(tmpPath, partPath);
        await fs.rename(partPath, fullPath);
      } finally {
        try { await fs.unlink(partPath); } catch {}
      }
    }
  } finally {
    if (tmpHandle) {
      try { await tmpHandle.close(); } catch {}
    }
    try { await fs.unlink(tmpPath); } catch {}
  }
}
```

**watcher 設定** (`src/watcher.js`):
- `ignored` に `'**/.~mdvtmp.*'`, `'**/.~mdvpart.*'` を追加
- `awaitWriteFinish` (既存) で部分 write 抑制

**起動時 sweep**:
- `rootDir` 配下を walk して `.~mdvtmp.*` のうち以下を **AND 条件**で削除:
  - mtime > 1 時間（古いもののみ）
  - lstat で `uid === process.getuid()`（**自分が所有する tmp のみ**）
- `pid` 判定は **使わない** (pid 再利用 / 別ユーザの kill 確認失敗で誤判定する)
- 他ユーザ所有の `.~mdvtmp.*` は触らない（unlink エラーログを避ける）
- `.~mdvpart.*` は当該 PUT 内で finally 削除されるので原則残らないが、
  起動時 sweep に含めて保険（同条件）。

### 5.6 TOCTOU 緩和 (best-effort)

完全な symlink 攻撃防御は Node には **`openat` 相当 API が無いため非対応**。
本実装は best-effort として:

```js
// 1. validatePathReal で realpath 解決済みのパス
// 2. open(O_NOFOLLOW) は **末尾コンポーネントのみ** symlink 拒否
const fd = await fs.open(realFullPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
const stat = await fd.stat();
const rawSource = await fd.readFile('utf-8');
await fd.close();

// ... splice ...

// 3. 書き込み直前に realpath 再解決して一致確認（中間 dir swap の検出）
const reResolved = await fs.realpath(fullPath);
if (reResolved !== realFullPath) {
  throw mkError('PATH_INVALID', 'path resolution changed');
}
// 4. 最終 lstat で dev/ino 確認（best-effort）
const currentLstat = await fs.lstat(realFullPath);
const inodeMismatch = currentLstat.dev !== stat.dev || currentLstat.ino !== stat.ino;
if (inodeMismatch) {
  // NFS / btrfs snapshot / exFAT では dev/ino が揺れる場合がある。
  // FS タイプを正確に判定する API は Node 標準にないので、
  // realpath 一致 (step 3) が通っていれば inode 不一致は警告ログのみで通過。
  console.warn('mdv: file inode changed during PUT (FS may be NFS/btrfs)', { path: realFullPath });
}
await atomicWrite(realFullPath, newSource, stat);
```

**`validatePath` vs `validatePathReal` の関係 (既存実装)**:
- `validatePath(targetPath, rootDir)`: 同期、文字列レベルのパス検証
  （絶対パス / `..` トラバーサル / null byte 拒否）。**書き込みでは不十分**。
- `validatePathReal(targetPath, rootDir)`: 非同期、`fs.realpath` で symlink
  解決後に rootDir 内に収まることを確認。**本機能の書き込み系は必ずこちら**。

**前提と限界 (best-effort)**:
- rootDir 配下に **悪意ある symlink を作らない** ことは運用前提（§11 に明記）。
- 中間 dir の symlink swap は **realpath 二重解決でしか検出できない**。
- **realpath の TOCTOU 窓は残存**: `realpath` 実行と `open` の間、`realpath`
  二重解決と `atomicWrite` rename の間に攻撃者が同 FS 上で symlink を swap
  すると検出を逃れる可能性がある。Node 標準には `openat` 相当 API がないため
  完全防御は実装範囲外。本リスクは「rootDir 配下に他者書き込み可能 dir を
  含めない」という運用前提で受容する（§11 非ゴール）。
- NFS/btrfs/exFAT 等で dev/ino が揺れるケースは警告ログで通過し、最終的な
  書き込みは validatePathReal + realpath 二重解決の保護に委ねる。

### 5.7 Origin / Host / Sec-Fetch-Site 検証 (CSRF / DNS rebinding 対策)

- 起動時に許可ホスト集合 `ALLOWED_HOSTS = { 'localhost:<port>', '127.0.0.1:<port>' }`
- middleware (PUT / OPTIONS):
  - **受理条件 (A or B)**:
    - (A) `Origin` ヘッダが `http://<許可ホスト>` のいずれかに一致
    - (B) `Origin` 欠落 + `Sec-Fetch-Site: same-origin`
      （Safari < 16 / file:// fetch / 拡張機能経由で Origin が `null` になる
      ケースを救済。Sec-Fetch-Site は Chromium/Firefox/Safari 16+ 対応）
  - 上記 (A)(B) どちらも満たさない場合 403 ORIGIN_REJECTED
  - `Origin: null` 単独は拒否
- 全リクエスト: `Host` ヘッダが許可セットになければ 403
- `Content-Type: application/json` を厳密に要求（simple-request 経路を物理的に塞ぐ）
- **トークンは導入しない**:
  - HTTP token (X-MDV-Token) は XSS 一発で漏洩する
  - 同等の防御は Origin + Sec-Fetch-Site + Content-Type 要求で達成
- 読み取り API への適用は別 PR（既存挙動維持）

### 5.8 watcher → broadcast → presenter フロー

- watcher の `change` イベントで:
  1. file を読む
  2. parseDeck で `{ etag, slideCount, notes }` を計算
  3. WebSocket broadcastFileUpdate に `{ ...rendered, etag, lineEnding, hasBom, notes }` を含める
- main client が受け取り、`tab.etag` / `tab.notes` を更新
- presenter window へ broadcastSlides で `{ ..., etag }` を流す
- presenter は `deckEtag` を更新。次の PUT の `If-Match` に使う

#### Adapter 契約破綻時の degrade

`parseDeck` が `NOT_PARSEABLE` を投げた場合:
- GET 応答: `{ ok: true, degraded: true, etag: null, notes: [] }`
  - **etag は返さない** (UI は If-Match を組み立てられないので物理的に PUT 不可)
- broadcast 同様: `{ etag: null, notes: [] }` で配布
- client 側: `tab.etag` が null なら presenter の保存ボタンを disable、編集 UI に
  「このファイルは現在解析できないため自動保存は無効です」と表示

これで「サイレント上書き」リスクが消える。

### 5.9 coalescing (per-(path, slideIndex))

per-(path, slideIndex) の保留キューに **最新 1 件のみ保持し、429 は返さない**。
新しい edit-note 到着時に既に直列化中なら、queue 上書きで「最後の値が必ず
処理される」ことを保証。

#### Superseded semantics

上書きで破棄される旧 promise は **`{ ok: true, superseded: true, etag: undefined,
normalizedNote: undefined }` で resolve**（reject しない、saved も嘘にならない）:

```js
class SaveQueue {
  // key: `${path}#${slideIndex}` → { latest: {note, resolve}, running: boolean }
  enqueue(path, slideIndex, note) {
    const key = `${path}#${slideIndex}`;
    return new Promise((resolve) => {
      const entry = this.map.get(key);
      if (entry) {
        // 旧 latest を superseded で完了させる
        entry.latest.resolve({ ok: true, superseded: true });
        entry.latest = { note, resolve };
        if (!entry.running) this.drain(key);
      } else {
        this.map.set(key, { latest: { note, resolve }, running: false });
        this.drain(key);
      }
    });
  }
  async drain(key) {
    const entry = this.map.get(key);
    if (!entry || entry.running) return;
    entry.running = true;
    try {
      while (entry.latest) {
        const { note, resolve } = entry.latest;
        entry.latest = null;
        try {
          const result = await this.doSave(...);  // PUT
          resolve(result);
        } catch (err) {
          // 例外は caller hang 回避のため必ず resolve で返す
          resolve({ ok: false, code: 'WRITE_FAILED', error: String(err.message || err) });
        }
        // ループは latest が再度上書きされていれば次イテレーション
      }
    } finally {
      // 例外パスでも running を必ずリセット → 次の enqueue で drain が起動可能
      entry.running = false;
      // latest がなければ map から削除（無ければ次の enqueue が新規 entry を作る）
      if (!entry.latest) this.map.delete(key);
    }
  }
}
```

client 側 `saveNote` は `if (data.superseded) return;` で何もせず、後続の保存
完了で notify される。

#### retry counter (client owner)

retry は **client side のみ** が管理する状態。サーバはステートレスで都度
`If-Match` を検証するだけ。retry は per-(path, slideIndex) で
**連続 STALE 3 回上限**:

```js
const key = `${path}#${slideIndex}`;
const count = this.staleStreak.get(key) || 0;
if (count >= 3) {
  this.notifyFailure(slideIndex, 'STALE — please reload');
  this.staleStreak.delete(key);
  return;
}
this.staleStreak.set(key, count + 1);
// retry...

// 成功時:
this.staleStreak.delete(key);
```

成功 (etag 更新) で必ず reset、新値投入で reset しない（連続 STALE を計測する）。

## 6. クライアント移行

### 6.1 PresenterView.saveNote

```js
async saveNote(path, slideIndex, note) {
  const tab = state.tabs.find((t) => t.path === path);
  if (!tab || !tab.isMarp || !tab.etag) return;

  const url = `/api/marp/decks/${encodeURIComponent(path)}/slides/${slideIndex}/note`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': tab.etag },
    body: JSON.stringify({ note })
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 412 && data.code === 'STALE') {
    // 直前の broadcast が遅延した可能性: 1 回だけ最新 etag で再 GET → 編集差分一致なら成功扱い
    const refreshed = await this.refreshDeck(path);
    if (!refreshed) {
      this.notifyFailure(slideIndex, 'STALE — please reload');
      return;
    }
    if (refreshed.notes[slideIndex] === note.trim()) {
      this.notifySuccess(slideIndex, refreshed.notes[slideIndex]);
      return;
    }
    // 差分があれば retry 1 回
    const key = `${path}#${slideIndex}`;
    if ((this.retryCounts.get(key) || 0) < 1) {
      this.retryCounts.set(key, (this.retryCounts.get(key) || 0) + 1);
      return this.saveNote(path, slideIndex, note);
    }
    this.notifyFailure(slideIndex, 'STALE — please reload');
    return;
  }
  // ... 他のエラー
  if (res.ok && data.ok) {
    tab.etag = data.etag;
    this.retryCounts.delete(`${path}#${slideIndex}`);
    this.notifySuccess(slideIndex, data.normalizedNote);
  }
}
```

`notifySuccess` は presenter に `normalizedNote` を渡す。

### 6.2 既存 `/api/file?path=...` の Marp 応答に etag 同梱

応答 shape:
```diff
  {
    name, content, raw, fileType, isMarp, css, notes,
+   etag, lineEnding, hasBom,
    ...
  }
```

shape 追加なので互換破壊なし。**テストで明示的に確認**。

### 6.3 Presenter UI 規約: 「note は最後の 1 つ」 + Multi-note Guard

- `notes[N]` は marp.render の comments[N] を `'\n\n'` で join した string
  （v0 から既存）。複数 note ある時はサーバ側でも UI 側でも join された 1 文字列。
- **編集 = サーバの「最後の note を置換」**。

**Multi-note Guard** (新規):
- サーバの GET 応答に **`notesMultiplicity[N] = comments[N].length`** を含める
  （配列 `notesMultiplicity` を notes と同じ長さで返す）
- presenter は `notesMultiplicity[currentSlide] > 1` を検出したら:
  - notes パネルを **read-only** に切り替え
  - バナー「このスライドは複数のノートを含むため自動保存を無効化しています」を表示
  - 編集したい場合は markdown editor で直接編集する旨を案内
- これで「最後の note 置換」による先頭 note 消失リスクを物理的に防ぐ
- 複数 note の個別編集は §11 非ゴール

### 6.4 broadcastSlides に etag 同梱

```diff
  this.channel.postMessage({
    type: 'slides',
    path: tab.path,
    html: tab.content,
    css: tab.css,
+   etag: tab.etag,
    notes: tab.notes || [],
    current: marpCurrentSlide
  });
```

Presenter 側で `deckEtag` を保持し、`edit-note` 送信時に同梱。
Main は受信 `edit-note` の deckEtag が `tab.etag` と一致するか確認し、
不一致なら直ちに presenter に「STALE — reload」を返す。

### 6.5 `marpNoteRewriter.js` 削除

- `src/static/marpNoteRewriter.js` 削除
- `src/static/index.html` から script 削除
- `tests/test-marp-note-rewriter.js` 削除（回帰テストは新方式に移植）

## 7. テスト戦略

### 7.1 Marpit Adapter 契約テスト

`tests/test-marpit-adapter.js`:
- snapshot: `marpit_slide_open.map = [startLine, endLine]`
- snapshot: `marpit_comment.content` が **右 trim 済 / 左空白保持**
- snapshot: `marpit_slide_close.map === null`
- snapshot: BOM 付き入力で `slide_open.map[0] === 0`
- snapshot: headingDivider 各形式で期待 slide 数

### 7.2 Splice 単体テスト

`tests/test-marp-note-writer.js`:

**不変条件**:
1. 編集対象 slide 外は **byte 完全一致** (`assert.strictEqual`)
2. 編集対象 slide のみ `classifiedNotes[i]` が期待値、他 slide は同値
3. EOF 改行の有無が入力と同じ
4. `lineEnding` を勝手に変換しない (既存改行は触らない)
5. BOM の有無が入力と同じ

**Marp 視点同値性アサート**:
```js
const before = parseDeck(input);
const after = parseDeck(output);
assert.strictEqual(after.slideCount, before.slideCount);
for (let i = 0; i < before.slideCount; i++) {
  if (i === slideIndex) {
    assert.deepStrictEqual(after.classifiedNotes[i], expectedNotes);
  } else {
    assert.deepStrictEqual(after.classifiedNotes[i], before.classifiedNotes[i]);
  }
}
```

### 7.3 過去 codex 指摘の回帰テスト (45 fixture)

`tests/fixtures/marp-notes/`:

#### v0 で codex が指摘した 27+3 件の再現
- `headingDivider-block-form.md`
- `leading-note-headingDivider.md`
- `lang-directive.md`
- `setext-h2.md`
- `fenced-comment.md`
- `headingDivider-comment-form.md`
- `setext-after-html-block.md`
- `lang-block-array.md`
- ...

#### 新規 edge case
- `bom-utf8.md`
- `crlf-only.md`
- `cr-only.md`
- `mixed-line-endings.md`
- `empty-comment.md`             // `<!-- -->`
- `directive-and-note-same-content.md` // dup の zip 検証
- `directive-only-slide.md`
- `slide-close-no-map.md`        // 末尾改行なし
- `huge-slide-1mb.md`            // perf 目視
- `surrogate-pair-emoji.md`
- `wide-space.md`
- `frontmatter-absent.md`
- `single-slide-no-notes-add.md` // 新規挿入位置の境界
- `last-slide-no-trailing-newline.md`
- ...

### 7.4 API 統合テスト

`tests/test-marp-note-api.js`:
- GET → PUT (If-Match) → 200 + new etag
- PUT (If-Match なし) → 428 + IF_MATCH_REQUIRED
- PUT (If-Match 古い) → 412 + currentEtag
- PUT (note に `-->`) → 400 INVALID_NOTE
- PUT (slideIndex out of range) → 400 OUT_OF_RANGE
- PUT (path traversal) → 403 PATH_INVALID
- PUT (symlink → /etc/hosts) → 403 PATH_INVALID
- PUT (Origin 不正) → 403 ORIGIN_REJECTED
- PUT (Host 不正) → 403 ORIGIN_REJECTED
- PUT (body 200KB) → 413 PAYLOAD_TOO_LARGE
- PUT (note 70KB) → 400 INVALID_NOTE
- PUT (read-only ファイル) → 403 READONLY
- PUT during external edit → 412 STALE
- PUT 時に dir が symlink に置換 → 403 PATH_INVALID (TOCTOU)
- atomic: 書き込み中に SIGINT → 元ファイル無傷
- watcher: 書き込み後 change 1 回、`.~mdvtmp.*` を ignore
- broadcast: WebSocket update に etag が含まれる

### 7.5 文字列セーフティ

`tests/test-marp-note-utf8.js`:
- BOM 付き入力で BOM 保持
- CRLF / CR 入力でその改行種別を保持
- 絵文字 (surrogate pair) を含む note の round-trip
- 全角空白を含む note の round-trip
- 末尾改行なし入力で末尾改行を勝手に増やさない

## 8. リスクと緩和

| リスク | 緩和 |
|---|---|
| Marp render が遅い (>500ms) | per-key coalesce で過剰呼び出し抑制。1 MB ファイルで実測 < 200ms を CI で監視 |
| `marpit_comment.content` の trim 仕様変更 | adapter 契約テストで凍結 |
| EXDEV / 権限喪失 / chown 失敗 | 5.5 で stat → chmod/chown → EXDEV 二段 + EPERM/ENOTSUP のみ握りつぶし |
| `.~mdvtmp.*` 残骸 | O_EXCL で排他作成、起動時 sweep は自 pid 既終了 + mtime > 1h のみ |
| Origin チェック誤拒否 | localhost / 127.0.0.1 + 起動 port のみ許可。null/欠落は明確に 403 |
| ETag 衝突 (sha256) | 数学的に無視可能 |
| client 編集中の broadcast でカーソル飛び | `normalizedNote` echo + DOM textContent 差分判定で抑制 |
| Adapter 契約破綻 | NOT_PARSEABLE で 500、GET は notes 空で degrade 動作 |

## 9. フェーズ

| Phase | 内容 | 目安 |
|---|---|---|
| 1 | Adapter + 契約テスト (BOM/CRLF/headingDivider各形式の snapshot 安定化) | 120 min |
| 2 | lineMath / atomicWrite / O_NOFOLLOW + realpath再解決 / dev/ino best-effort | 120 min |
| 3 | Splice + 不変条件テスト + 文字列セーフティ + multi-note guard | 120 min |
| 4 | API endpoint (GET/PUT/OPTIONS) + ETag + Origin/Host/Sec-Fetch-Site + degrade応答 | 120 min |
| 5 | Client 移行 + saveNote + broadcastSlides に etag + Multi-note Guard | 90 min |
| 6 | 回帰 fixture 45 件 (1件 4分換算) | 180 min |
| 7 | API 統合テスト + watcher integ + degrade ケース | 120 min |
| 8 | codex-loop で再検証 (2〜3 周想定) | 180 min |
| 9 | コミット + CHANGELOG | 15 min |

合計 17時間45分（17h45m）。Round 3 で「v3 の 12h は楽観的、16〜18h が現実」との指摘を反映。

## 10. Edge Case カバレッジ表

| 項目 | v0 (regex) | v3 (token) |
|---|---|---|
| `---` / `***` / `___` 区切り | 個別 regex | tokens 自動 |
| setext H2 | パラグラフ判定 | Marpit が認識 |
| fenced code 内の `---` | fence-tracking | tokens 自動 |
| fenced code 内のコメント | range フィルタ | tokens に出ない |
| headingDivider scalar | 対応 | tokens 自動 |
| headingDivider inline-array | 対応 | tokens 自動 |
| headingDivider block-array | **未対応** | tokens 自動 |
| headingDivider in HTML comment | 対応 | tokens 自動 |
| directive comment `_class:` | whitelist | render() が除外 |
| directive comment `lang:` | 追加済 | render() が除外 |
| directive comment 未知 key | **誤判定** | render() が正しく扱う |
| directive と note 同 content | **誤判定** | 順序 zip + count assert |
| 先頭 directive + headingDivider | 対応 | tokens 自動 |
| 先頭 note + headingDivider | **未対応** | tokens 自動 |
| `-->` / `--!>` / `--$` | validate | validate (継続) |
| 連続保存 race | client queue | + ETag 412 |
| inactive tab race | **未対応** | ETag 412 で検出 |
| 外部エディタ race | **未対応** | ETag 412 で検出 |
| BOM 付きファイル | 一部対応 | lineMath で完全 |
| CRLF / CR / 混在 改行 | 一部対応 | 既存改行保持、新規挿入のみ最頻種 |
| 絵文字 / 全角空白 | 一部対応 | UTF-16 string splice で安全 |
| ファイル権限保持 | OS 任せ | stat → chmod/chown (EPERM 限定) |
| Symlink path traversal | **抜け** | validatePathReal + O_NOFOLLOW |
| Symlink 差し替え (TOCTOU) | **抜け** | open + dev/ino check |
| EXDEV | 未考慮 | 二段 rename fallback |
| CSRF | 未考慮 | Origin + Host |
| DNS rebinding | 未考慮 | Host ホワイトリスト |
| PNA preflight | 未考慮 | Allow-Private-Network |
| 巨大 body | 未考慮 | 128KB limit + 専用 413 ハンドラ |
| Proto pollution | 未考慮 | Object.create(null) |
| info 漏洩 (stack trace) | 未考慮 | error 文言 whitelist |

## 11. 非ゴール

- 読み取り系 API への CSRF / Origin 適用（別 PR、現状維持＝localhost 信頼前提）
- IP-based rate limit（localhost 前提）
- ノートの markdown レンダリング（平文保存維持）
- 複数ユーザの conflict resolution UI（412 STALE のメッセージ表示まで）
- ノート履歴 / undo（独立 feature）
- **複数 note を 1 スライドに持つファイルでの自動保存**（Multi-note Guard で
  read-only に degrade。手動編集は markdown editor で）
- 他プロセス（複数 mdv インスタンス同時起動）での temp 共存（O_EXCL で衝突は
  検出する。並行書き込み可は ETag に委ねる）
- **rootDir 配下の悪意 symlink 防御**（中間 dir symlink swap は realpath
  二重解決の best-effort のみ。完全防御は openat 系 API 必須で Node 範囲外。
  realpath〜open / realpath二重解決〜rename の TOCTOU 窓は残存する）
- **PNA からの cross-origin アクセス**（明示的に拒否、localhost 同一オリジン
  使用前提）
- **`Sec-Fetch-Site` ヘッダの完全な spoofing 防御**: fetch 標準では禁止
  ヘッダだが curl/拡張機能から手動送信可能。本機能は (A) Origin 一致を
  一次防御とし、(B) Sec-Fetch-Site=`same-origin` 単独経路は **localhost 信頼
  前提に依存する** ことを既知化する。
- **Safari < 16 のサポート**: Sec-Fetch-Site 未実装のため Origin 欠落 fetch
  経路で誤拒否される可能性あり。reload で同一オリジン再取得を求める UX で
  代替（ブラウザシェアが小さいので非ゴール）。

## 12. v4 → v5 主要変更サマリ

| 項目 | v4 | v5 |
|---|---|---|
| `notesMultiplicity` | UI guard で言及のみ | **§4.1 GET / §5.2 parseDeck / §5.8 broadcast に shape 明示** |
| Multi-note Guard | client 側のみ | **server 側でも 409 MULTI_NOTE_READONLY 強制** |
| SaveQueue drain 例外時 | running 残留可能性 | **try/finally で必ずリセット + caller hang 回避** |
| retry counter | server/client 二重 | **client owner と明示** |
| validatePath / Real | 関係未記述 | **§5.6 で明確化、書き込みは Real 必須** |
| realpath TOCTOU 窓 | 暗黙 | **§5.6 と §11 で既知化** |
| Sec-Fetch-Site spoofing 限界 | 未明示 | **§11 に既知化** |
| Safari < 16 | 未明示 | **§11 で非ゴール** |
| Phase 合計 | ~17.5h | **17h45m に統一** |

## 13. v3 → v4 主要変更サマリ (履歴)

| 項目 | v3 | v4 |
|---|---|---|
| PNA preflight | Allow-Private-Network 返却 | **明示拒否**（§4.3 と §5.7 整合） |
| Origin 判定 | Origin のみ | **Origin + Sec-Fetch-Site 併用**（Safari/null 救済） |
| Content-Type 要求 | 暗黙 | **`application/json` 厳密要求** |
| Multi-note ファイル | 編集可（先頭 note 消失） | **read-only に degrade**（Multi-note Guard） |
| GET degrade 時の etag | 値あり | **null で返す**（UI 物理的に保存不可） |
| SaveQueue 上書き古 promise | 仕様未定義 | **`{ ok: true, superseded: true }` で resolve** |
| retry counter 限界 | per-(path,slideIndex) 1 回 | **連続 STALE 3 回上限** |
| BOM 行カウント | 「行0前置」 | **rawSource[0]に保持、lineStarts[0]=0** + 契約テスト |
| O_NOFOLLOW | 完全防御主張 | **best-effort、中間 dir は realpath 二重解決** |
| dev/ino check | 厳密判定 | **NFS/btrfs 揺れは警告のみで通過** |
| sweep 条件 | pid 現存 + mtime > 1h | **uid 自分 + mtime > 1h**（pid 判定廃止） |
| 見積もり | 12h | **17.5h**（Phase 1/3/6/7/8 を増額） |

## 14. v2 → v3 主要変更サマリ (履歴)

| 項目 | v2 | v3 |
|---|---|---|
| CSRF 対策 | Origin+Host+token | **Origin+Host のみ** (XSS 漏洩リスク回避) |
| broadcast の etag | 未明示 | **必須同梱** |
| Presenter UI 規約 | 暗黙 | **「最後の note のみ」と非ゴールに明記** |
| BOM 行カウント | 行0前置 (off-by-one) | **行0の一部** (marpit と整合) |
| directive フィルタ | content 比較頼み | **順序 zip + count assert** |
| EXDEV fallback | copyFile + unlink | **2 段 rename** |
| chmod 失敗 | 全握りつぶし | **EPERM/ENOTSUP のみ** |
| temp 名 | 固定 `.~mdvtmp` | **`.~mdvtmp.<pid>.<rand>` + O_EXCL** |
| coalesce 単位 | per-path | **per-(path, slideIndex)** |
| coalesce 動作 | 429 で破棄 | **queue 上書きで最後値必ず処理** |
| Symlink TOCTOU | 未対応 | **open + dev/ino check** |
| 413 ハンドラ | 未明記 | **専用 + 文言 whitelist** |
| PNA preflight | 未対応 | **Allow-Private-Network** |
| 末尾 slide 挿入 | `slideEnd-1` 曖昧 | **逆走査で最後の非空行 + EOF 改行保持** |
| Adapter 責務 | 曖昧 | **parseDeck / pickNoteComments / splice の3層を明示** |
