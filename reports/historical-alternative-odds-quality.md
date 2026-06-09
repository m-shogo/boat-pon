# historical_alternative_odds 保存品質チェック

生成日時: 2026-06-09T09:26:26.594Z

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> **historical closing odds は live/T-5/timeseries odds ではない。**

---

## 基本統計

| 項目 | 値 |
|---|---|
| 総レコード数 | 827 |
| ユニーク race 数 | 166 |
| データ期間 | 2025-02-02 〜 2025-11-08 |
| 5買い目全て揃っている race 数 | 165 / 166 (99%) |
| 4買い目のみの race 数 | 0 (欠場等で正常なスキップ) |
| condB 該当 race 数 | 166 |

## combination 別件数

| combination | 件数 | 率 |
|---|---:|---:|
| 1-2-3 | 166 | 100% |
| 1-2-4 | 165 | 99% |
| 1-3-2 | 166 | 100% |
| 1-3-4 | 165 | 99% |
| 1-4-2 | 165 | 99% |

## 同値チェック

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| 5買い目揃い race | 165 | — | — |
| 1-2-3=1-3-2 同値 | 0 | 0% | ✅ OK |
| 5買い目全同値 | 0 | 0% | ✅ OK |

## 異常値チェック

| 項目 | 件数 | 判定 |
|---|---:|---|
| odds ≤ 0 | 0 | ✅ OK |
| odds = NULL | 0 | ✅ OK |
| odds > 9999 | 0 | ✅ OK |

## source フィールド確認

| 項目 | 件数 | 率 | 判定 |
|---|---:|---:|---|
| source_type=official_archive | 827 | 100% | ✅ |
| source_quality=historical_closing_odds | 827 | 100% | ✅ |
| is_backfill=1 | 827 | 100% | ✅ |
| source_url あり | 827 | 100% | ✅ |
| fetched_at あり | 827 | 100% | ✅ |
| parser_version あり | 827 | 100% | ✅ |

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

**✅ 品質良好。次回 --limit 200 --write へ進んでよい。**

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