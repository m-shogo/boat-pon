# historical_alternative_odds テーブル作成レポート

生成日時: 2026-06-09T09:13:38.925Z

> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。
> このテーブルは historical closing odds 専用。live/timeseries odds は別テーブル。

---

## 実行結果

| 項目 | 結果 |
|---|---|
| 実行前テーブル存在 | ✅ なし（新規作成） |
| CREATE TABLE | ✅ 実行済み |
| 追加されたテーブル | historical_alternative_odds |
| 削除されたテーブル | ✅ なし |

## テーブル schema 確認

| cid | name | type | NOT NULL | default | PK |
|---|---|---|:---:|---|:---:|
| 0 | id | INTEGER | — | — | ✅ |
| 1 | race_id | TEXT | ✅ | — | — |
| 2 | race_date | TEXT | ✅ | — | — |
| 3 | venue | TEXT | ✅ | — | — |
| 4 | venue_code | TEXT | ✅ | — | — |
| 5 | race_no | INTEGER | ✅ | — | — |
| 6 | combination | TEXT | ✅ | — | — |
| 7 | odds | REAL | ✅ | — | — |
| 8 | source_type | TEXT | ✅ | 'official_archive' | — |
| 9 | source_quality | TEXT | ✅ | 'historical_closing_odds' | — |
| 10 | source_url | TEXT | ✅ | — | — |
| 11 | fetched_at | TEXT | ✅ | — | — |
| 12 | parser_version | TEXT | ✅ | '1.0' | — |
| 13 | is_backfill | INTEGER | ✅ | 1 | — |
| 14 | fetch_status | TEXT | ✅ | 'success' | — |
| 15 | notes | TEXT | — | — | — |

## インデックス確認

| name | unique | origin |
|---|:---:|---|
| idx_hao_source | — | c |
| idx_hao_combination | — | c |
| idx_hao_race_no | — | c |
| idx_hao_venue | — | c |
| idx_hao_race_date | — | c |
| idx_hao_race_id | — | c |
| uq_historical_alternative_odds_key | ✅ UNIQUE | c |

## 既存テーブルへの影響確認

| 確認 | 結果 |
|---|---|
| 削除テーブルなし | ✅ |
| decision_history 変更なし | ✅ |
| odds_snapshots 変更なし | ✅ |
| odds_timeseries_snapshots 変更なし | ✅ |

---
*生成: create-historical-alternative-odds-table.ts*