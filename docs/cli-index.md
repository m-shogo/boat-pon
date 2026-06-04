# boat-pon CLI Index

boat-pon の CLI が増えてきたため、用途別に整理した索引です。

重要:

- `fetch:*` / `backfill:*` は外部取得を伴う可能性があります。
- `report:*` / `check:*` / `audit:*` は基本的に read-only です。
- 自動投票・ログイン保存・投票サイト操作は入れません。

## 毎日/定期運用

| command | 目的 | 注意 |
|---|---|---|
| `pnpm catchup` | 取りこぼし補完 | 外部取得あり |
| `pnpm daily` | 日次処理 | 外部取得あり |
| `pnpm health` | 全体ヘルス確認 | 基本read-only |
| `pnpm backup:safe` | 安全バックアップ | 推奨 |
| `pnpm backup` | 安全バックアップ | `backup-db-safe.ts` を使用 |

## 100点化チェック

| command | 目的 |
|---|---|
| `pnpm check:100` | 100点化に必要な残項目を確認 |
| `pnpm check:100 -- --strict` | 未達なら非0終了 |
| `pnpm audit:persistence` | audit保存の接続状態を確認 |
| `pnpm audit:persistence -- --strict` | audit保存が未達なら非0終了 |
| `pnpm patch:paper-wording -- --dry-run` | paper通知文言の安全化差分を確認 |
| `pnpm patch:paper-wording -- --write` | paper通知文言を安全側に置換 |

## 一括レビュー

| command | 目的 |
|---|---|
| `pnpm review:suite -- --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD` | 主要reviewを一括実行 |
| `pnpm review:suite -- --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD --keep-going` | 途中失敗しても続行 |
| `pnpm review:log -- --date YYYY-MM-DD --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD` | 日付付きレビュー記録を作成 |

推奨例:

```bash
pnpm review:log -- --date 2026-06-04 --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
pnpm review:suite -- --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
```

## レビュー・分析CLI

### 最初に見る

| command | 目的 |
|---|---|
| `pnpm report:review-summary -- --from YYYY-MM-DD --to YYYY-MM-DD` | 全体サマリー |
| `pnpm report:rule-candidates -- --from YYYY-MM-DD --to YYYY-MM-DD --min-settled 50` | ルール見直し候補 |
| `pnpm report:decision-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD` | BUY/WATCH/SKIP結果比較 |

### 外れ・見送り確認

| command | 目的 |
|---|---|
| `pnpm report:buy-misses -- --from YYYY-MM-DD --to YYYY-MM-DD` | BUYしたが外れたもの |
| `pnpm report:missed-hits -- --from YYYY-MM-DD --to YYYY-MM-DD` | WATCH/SKIPで当たっていたもの |
| `pnpm report:decision-reasons -- --from YYYY-MM-DD --to YYYY-MM-DD` | decision reasonの集計 |

### オッズ・市場

| command | 目的 |
|---|---|
| `pnpm report:clv -- --from YYYY-MM-DD --to YYYY-MM-DD` | CLV確認 |
| `pnpm report:odds-band-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | オッズ帯別のBUY成績 |
| `pnpm report:market-warnings -- --from YYYY-MM-DD --to YYYY-MM-DD` | 市場が嫌ったBUY / 買ったWATCHを確認 |
| `pnpm report:popularity-movement -- --from YYYY-MM-DD --to YYYY-MM-DD` | 人気順位推移 |

### データ品質・特徴量

| command | 目的 |
|---|---|
| `pnpm report:data-quality-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | データ品質別のBUY成績 |
| `pnpm report:feature-breakdown -- --from YYYY-MM-DD --to YYYY-MM-DD` | feature adjustment確認 |
| `pnpm report:data-coverage` | データカバレッジ |
| `pnpm stats:racer-coverage` | 選手成績カバレッジ |

### 確率・安定性

| command | 目的 |
|---|---|
| `pnpm report:calibration -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 推定的中率の校正 |
| `pnpm report:payout-sensitivity -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 上位配当依存確認 |
| `pnpm report:time-split-stability -- --from YYYY-MM-DD --split-date YYYY-MM-DD --to YYYY-MM-DD --decision BUY --min-settled 50` | 前半/後半の安定性 |
| `pnpm report:model-version-simple -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | model_version比較 |

### 会場/月別

| command | 目的 |
|---|---|
| `pnpm report:venue-monthly -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 会場・月別確認 |
| `pnpm report:quality -- --days 30` | 直近品質確認 |
| `pnpm report:weekly` | 週次品質 |
| `pnpm report:monthly` | 月次品質 |

## 取得・補完CLI

外部取得を伴うため、必要な時だけ実行します。

| command | 目的 |
|---|---|
| `pnpm fetch:official-results` | 公式結果取得 |
| `pnpm fetch:official-programs` | 公式番組取得 |
| `pnpm fetch:pending` | pending取得 |
| `pnpm backfill:odds` | オッズ補完 |
| `pnpm backfill:beforeinfo` | 直前情報補完 |
| `pnpm backfill:beforeinfo:dry` | beforeinfo補完dry-run |
| `pnpm fetch:racer-stats` | 選手成績取得 |
| `pnpm fetch:racer-stats:dry` | 選手成績dry-run |

## DB・監査・検証

| command | 目的 |
|---|---|
| `pnpm db:init` | DB初期化 |
| `pnpm db:health` | DBヘルス確認 |
| `pnpm validate:data` | データ検証 |
| `pnpm migrate:decision-audit` | decision auditカラムmigration |
| `pnpm audit:doctor` | audit状態診断 |
| `pnpm audit:persistence` | audit fieldsのDB/コード接続確認 |
| `pnpm fill:decision-reasons` | decision reasons補完 |

## 開発・検証

| command | 目的 |
|---|---|
| `pnpm typecheck:scripts` | scripts型チェック |
| `pnpm test` | domain test |
| `pnpm typecheck` | 全体型チェック |
| `pnpm build` | build |
| `pnpm verify` | typecheck + test + build |

## 推奨レビュー順

```bash
pnpm check:100
pnpm audit:persistence
pnpm review:suite -- --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
pnpm typecheck:scripts
pnpm test
pnpm audit:doctor
pnpm backup
```

## 今後の命名整理案

今後 scripts がさらに増えるなら、package scripts を以下のように寄せると見やすいです。

```text
review:*   検証・反省レポート
fetch:*    外部取得
backfill:* 補完
ops:*      backup / health / readiness
migrate:*  DB migration
```

ただし、既存コマンドを壊さないため、まずは alias 追加から行い、削除・改名はしない方針です。
