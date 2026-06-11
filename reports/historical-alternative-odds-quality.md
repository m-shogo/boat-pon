# historical_alternative_odds 保存品質チェック

生成日時: 2026-06-11T02:08:30.162Z

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> **historical closing odds は live/T-5/timeseries odds ではない。**

---

## 基本統計

| 項目 | 値 |
|---|---|
| 総レコード数 | 2092 |
| ユニーク race 数 | 419 |
| データ期間 | 2025-02-01 〜 2026-05-20 |
| 5買い目全て揃っている race 数 | 418 / 419 (100%) |
| 4買い目のみの race 数 | 0 (欠場等で正常なスキップ) |
| condB 該当 race 数 | 167 / 167 |
| skip6R 該当 race 数 | 215 / 215 (100%) |
| skipVenue 該当 race 数 | 102 / 159 (64%) ※下記注意参照 |
| skip6R × skipVenue 重複 | 33 |

> **⚠️ skipVenue coverage 注意**: skipVenueInTable の件数増加は skip6R backfill 対象レースが skipVenue 条件にも重複該当したためであり、
> skipVenue を意図的に write したものではない。skipVenue 専用 backfill は H004 完了後に着手する。

## combination 別件数

| combination | 件数 | 率 |
|---|---:|---:|
| 1-2-3 | 419 | 100% |
| 1-2-4 | 418 | 100% |
| 1-3-2 | 419 | 100% |
| 1-3-4 | 418 | 100% |
| 1-4-2 | 418 | 100% |

## 同値チェック

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| 5買い目揃い race | 418 | — | — |
| 1-2-3=1-3-2 同値 | 0 | 0% | ✅ OK |
| 5買い目全同値 | 0 | 0% | ✅ OK |

## 異常値チェック

| 項目 | 件数 | 判定 |
|---|---:|---|
| odds ≤ 0 | 0 | ✅ OK |
| odds = NULL | 0 | ✅ OK |
| odds > 9999 | 0 | ✅ OK |

## 買い目間 odds spread トップ5 (異常確認)

> 同一 race 内での最大 odds - 最小 odds の乖離。historical closing odds は締切直前値のため
> current_odds (意思決定時の暫定値) と 40〜50pt 前後の差が生じることは正常動作。

| race_id | race_date | venue | R | max_odds | min_odds | delta |
|---|---|---|---:|---:|---:|---:|
| 20250705-住之江-06 | 2025-07-05 | 住之江 | 6 | 815.1 | 9 | 806.1 |
| 20250601-鳴門-06 | 2025-06-01 | 鳴門 | 6 | 801.6 | 72.8 | 728.8 |
| 20250901-住之江-01 | 2025-09-01 | 住之江 | 1 | 726.8 | 28.4 | 698.4 |
| 20250503-浜名湖-06 | 2025-05-03 | 浜名湖 | 6 | 633.4 | 41.7 | 591.7 |
| 20250512-芦屋-06 | 2025-05-12 | 芦屋 | 6 | 596.8 | 38.6 | 558.2 |

## source フィールド確認

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| source_type=official_archive | 2092 | 100% | ✅ |
| source_quality=historical_closing_odds | 2092 | 100% | ✅ |
| is_backfill=1 | 2092 | 100% | ✅ |
| source_url あり | 2092 | 100% | ✅ |
| fetched_at あり | 2092 | 100% | ✅ |
| parser_version あり | 2092 | 100% | ✅ |

## 既存テーブルへの影響確認

| 確認 | 結果 |
|---|---|
| odds_snapshots に historical_closing_odds レコードなし | ✅ なし |
| odds_timeseries_snapshots に historical_closing_odds レコードなし | ✅ なし |

## 5買い目未満のレース（欠場等）

| race_id | 取得買い目数 | 取得済み | 備考 |
|---|---:|---|---|
| 20251001-鳴門-05 | 2/5 | 1-2-3,1-3-2 | 欠場/非販売の可能性あり |

---

## 総合判定

**✅ 品質良好。skip6R 次バッチ (pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000) へ進んでよい。残 0/215 件。**

---

## 注記

- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない
- 事前代替 odds 不足のため switch 本採用不可
- **historical closing odds backfill ができても live/T-5 forward ではない**
- 現時点で採用可能なのは skip monitor のみ
- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可
- switch は必ず future-only odds_timeseries で再確認する

---
*生成: check-historical-alternative-odds-quality.ts*