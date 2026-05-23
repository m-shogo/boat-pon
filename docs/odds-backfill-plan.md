# 過去オッズ補完の安全設計

最終更新: 2026-05-23

期待値の本体は `推定的中率 × 実オッズ` なので、過去オッズは重要。
ただし外部サイトへ大量アクセスしないことを最優先にする。

## 方針

- 全会場・全レース・全買い目の総当たり取得はしない。
- ウォークフォワードで候補になったレースだけを対象にする。
- 1日あたりの取得上限を設ける。
- raw HTMLを保存し、再取得しない。
- 失敗した日/レースはスキップし、連打しない。
- 自動購入・投票サイト操作・ログイン保存とは完全に分離する。

## データ層案

```
data/raw/kyotei24/odds/YYYY-MM-DD/<raceId>.html
data/normalized/odds/YYYY-MM-DD/<raceId>.json

SQLite:
odds_snapshots(
  race_id,
  selection,
  odds,
  popularity,
  source,
  captured_at,
  is_final_like
)
```

## 実装順

1. 既存のウォークフォワード候補から、必要オッズが現実的な範囲の raceId だけリスト化。
2. kyotei24/公式の過去オッズURLを1件だけ手動検証。
3. fixture HTMLを追加してパーサーを先に作る。
4. 取得スクリプトは `--limit` 必須、キャッシュ必須にする。
5. BUY判定には、`odds_snapshots` の最終確認に近いオッズだけ使う。

## 取得元の役割分担

- 公式 `boatrace.jp/owpc/pc/race/odds3t`
  - 今日の候補レース、締切前の最終確認用。
  - `scripts/fetch-official-odds.ts` で候補レースだけ低頻度取得する。
  - 過去レースの大量補完には使わない。
- kyotei24 / 競艇倶楽部
  - 過去検証用のオッズ補完候補。
  - 現時点の候補URL:
    - `https://odds.kyotei24.jp/od3t-<venueSlug>-YYYYMMDD-R.html`
    - `https://odds.kyotei24.jp/od-YYYYMMDD-JCD-R.html`
  - `scripts/backfill-odds.ts` で `decision_history` の BUY/WATCH かつオッズ未取得レースだけを対象にする。
- 手動入力
  - 公式/kyotei24で取れない場合のフォールバック。

## 安全CLI

```bash
npm run backfill:odds -- --dry-run --limit 10 --from 2026-05-01 --to 2026-05-23
npm run backfill:odds -- --limit 1 --race-id 20260521-蒲郡-08
npm run backfill:odds -- --dry-run --limit 1 --race-id 20250625-唐津-03 --selection 1-2-3
npm run backfill:odds -- --dry-run --limit 5 --include-existing
npm run backfill:odds -- --dry-run --limit 10 --include-skip-required-odds
```

安全仕様:

- `--limit` がない場合は拒否。
- `--dry-run` ではURL候補だけ表示し、外部取得しない。
- 対象は `decision_history` の `BUY/WATCH` かつ `current_odds` 未取得に限定。
- `--race-id` と `--selection` を併用すると、DB履歴がなくても1レースだけURL検証できる。
- `--include-existing` を付けた時だけ、既存オッズありのBUY/WATCHも検証対象に含める。
- `--include-skip-required-odds` を付けると、必要オッズ80倍以下のSKIP(主にオッズ未取得)も補完対象に含める。
- 既に `odds_snapshots` に同じ `raceId + selection` がある候補は再取得しない。
- raw HTMLキャッシュがあれば再取得しない。
- 取得ごとに1.5秒以上待つ。
- 失敗してもリトライ連打しない。
- rawは `data/raw/kyotei24/odds/YYYY-MM-DD/` に保存。
- normalized JSONは `data/normalized/odds/YYYY-MM-DD/` に保存。
- SQLiteは `odds_snapshots` に追記。

## 採用判断

- 過去オッズ込みウォークフォワードで、BUY数が少なく、月別ROIのブレが小さい条件だけ採用。
- ROIが良くてもBUY数が極端に少ない条件は過学習扱い。
- オッズ取得できない候補はBUYにしない。必要オッズ提示に留める。
