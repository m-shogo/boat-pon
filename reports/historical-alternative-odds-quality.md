# historical_alternative_odds 保存品質チェック

生成日時: 2026-06-09T12:51:54.302Z

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> **historical closing odds は live/T-5/timeseries odds ではない。**

---

## 基本統計

| 項目 | 値 |
|---|---|
| 総レコード数 | 1132 |
| ユニーク race 数 | 227 |
| データ期間 | 2025-02-02 〜 2026-05-20 |
| 5買い目全て揃っている race 数 | 226 / 227 (100%) |
| 4買い目のみの race 数 | 0 (欠場等で正常なスキップ) |
| condB 該当 race 数 | 167 / 167 |
| skip6R 該当 race 数 | 83 / 215 (39%) |
| skipVenue 該当 race 数 | 24 / 159 (15%) ※下記注意参照 |
| skip6R × skipVenue 重複 | 15 |

> **⚠️ skipVenue coverage 注意**: skipVenueInTable の件数増加は skip6R backfill 対象レースが skipVenue 条件にも重複該当したためであり、
> skipVenue を意図的に write したものではない。skipVenue 専用 backfill は H004 完了後に着手する。

## combination 別件数

| combination | 件数 | 率 |
|---|---:|---:|
| 1-2-3 | 227 | 100% |
| 1-2-4 | 226 | 100% |
| 1-3-2 | 227 | 100% |
| 1-3-4 | 226 | 100% |
| 1-4-2 | 226 | 100% |

## 同値チェック

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| 5買い目揃い race | 226 | — | — |
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
| 20250709-常滑-02 | 2025-07-09 | 常滑 | 2 | 530.4 | 37.7 | 492.7 |
| 20250309-平和島-03 | 2025-03-09 | 平和島 | 3 | 524.4 | 44.3 | 480.1 |
| 20251001-鳴門-06 | 2025-10-01 | 鳴門 | 6 | 487.6 | 51 | 436.6 |
| 20251007-常滑-07 | 2025-10-07 | 常滑 | 7 | 483.2 | 51.2 | 432 |
| 20250808-大村-06 | 2025-08-08 | 大村 | 6 | 370.2 | 31.4 | 338.8 |

## source フィールド確認

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| source_type=official_archive | 1132 | 100% | ✅ |
| source_quality=historical_closing_odds | 1132 | 100% | ✅ |
| is_backfill=1 | 1132 | 100% | ✅ |
| source_url あり | 1132 | 100% | ✅ |
| fetched_at あり | 1132 | 100% | ✅ |
| parser_version あり | 1132 | 100% | ✅ |

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

**✅ 品質良好。skip6R 次バッチ (pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000) へ進んでよい。残 132/215 件。**

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