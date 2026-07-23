# historical_alternative_odds テーブル設計案

生成日時: 2026-07-20T09:58:09.065Z

> ⚠️ **設計案のみ。今回は実DBへのCREATE TABLE実行なし。**
> **DB書き込みは次フェーズで dry-run 確認後に行う。**
> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。

---

## 現状確認

| 項目 | 値 |
|---|---|
| テーブル存在確認 | ⚠️ 既存あり |
| forward BUY 総件数 | 1522 |
| 取得対象レコード予定 | 7610件 (1522races × 5買い目) |
| うち条件B | 167 |
| うち6R | 215 |
| うち浜名湖 | 83 |
| うち住之江 | 76 |
| うちその他 | 1046 |

---

## 既存テーブルに混ぜない理由

### odds_snapshots を使わない理由

| 理由 | 詳細 |
|---|---|
| 品質バグ | backfill 時に 1-3-2 = 1-2-3 が記録されたレコードが 124/125 件存在 |
| 意味が違う | odds_snapshots は「BUY 候補レースの事前odds取得記録」。historical closing は後日取得の締切時オッズ |
| source区別不能 | is_final_like / source カラムだけでは live/closing の区別が難しい |
| 将来の混乱を防ぐ | 分析時に historical closing と live odds が混在するとバイアスになる |

### odds_timeseries_snapshots を使わない理由

| 理由 | 詳細 |
|---|---|
| 設計目的が違う | timeseries は checkpoint (T-5/T-10/T-20/T-30) 別の事前odds。historical closing は締切後取得 |
| 期間が違う | timeseries は 2026-06 開始。forward BUY は 2025-01 〜。重複ゼロ |
| 混在禁止 | timeseries が将来 switch 分析の基準になる。historical closing を混入すると信頼性が崩れる |

---

## historical closing odds と live/timeseries odds の違い

| 項目 | historical closing odds | live/timeseries odds |
|---|---|---|
| 取得タイミング | **後日取得**（公式アーカイブから事後収集） | リアルタイム（T-5/T-10等） |
| 信頼性 | 締切時の確定オッズに近い（変動あり） | 買い前の事前判断材料 |
| forward 分析に使えるか | **参考**（switch backtest）| ✅ 本来の事前 odds |
| switch 本採用の根拠になるか | ❌ 参考のみ（live での未検証） | 将来は ✅（timeseries n=200 後） |
| 変数名 / カラム名 | source_quality = 'historical_closing_odds' | checkpoint_label = 'T-5' 等 |

---

## switch 分析で使える範囲

> ⚠️ **注意: switch 分析は historical closing odds だけでは本採用できない**

| 分析 | 使えるか | 条件 |
|---|---|---|
| historical switch backtest | ⚠️ 参考のみ | historical closing odds が揃えば可能 |
| forward switch 分析（正式） | ❌ 現在不可 | timeseries BUY forward 重複 n≥200 が条件 |
| switch 本採用 | ❌ 現在不可 | live/T-5 odds での未検証のため |
| skip monitor | ✅ 現行可能 | 既存 forward で実施中 |

**現時点で採用可能なのは skip monitor のみ。**

---

## CREATE TABLE SQL 案

```sql
-- ⚠️ 設計案のみ。今回は実行しない。実行は次フェーズで確認後に行う。
CREATE TABLE historical_alternative_odds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- レース識別 (decision_history.race_id と JOIN 可能)
  race_id      TEXT NOT NULL,
  race_date    TEXT NOT NULL,  -- YYYY-MM-DD
  venue        TEXT NOT NULL,
  venue_code   TEXT NOT NULL,  -- 2桁場コード (01〜24)
  race_no      INTEGER NOT NULL,

  -- 代替買い目 odds
  combination  TEXT NOT NULL,  -- '1-2-3' / '1-3-2' / '1-2-4' / '1-4-2' / '1-3-4'
  odds         REAL NOT NULL,

  -- データソース情報 (live odds / timeseries odds と明確に区別する)
  source_type    TEXT NOT NULL DEFAULT 'official_archive',
  source_quality TEXT NOT NULL DEFAULT 'historical_closing_odds',
  -- source_quality: 'historical_closing_odds' のみ使用。
  --   live_odds / t5_odds / timeseries_odds とは絶対に混同しない。

  source_url   TEXT NOT NULL,  -- 取得元 URL
  fetched_at   TEXT NOT NULL,  -- ISO8601 取得日時
  parser_version TEXT NOT NULL DEFAULT '1.0',

  -- backfill フラグ
  is_backfill  INTEGER NOT NULL DEFAULT 1,  -- 常に 1 (後日補完)

  -- 品質ステータス
  fetch_status TEXT NOT NULL DEFAULT 'success',
  -- 'success' / 'fetch_error' / 'parse_error' / 'no_odds_found'

  notes        TEXT  -- 備考 (parse失敗理由等)
);

-- ユニーク制約: 同一レース×買い目×ソース種別の重複を防ぐ
CREATE UNIQUE INDEX uq_historical_alternative_odds_key
  ON historical_alternative_odds (race_id, combination, source_type, source_quality);

-- 検索用インデックス
CREATE INDEX idx_hao_race_id    ON historical_alternative_odds (race_id);
CREATE INDEX idx_hao_race_date  ON historical_alternative_odds (race_date);
CREATE INDEX idx_hao_venue      ON historical_alternative_odds (venue);
CREATE INDEX idx_hao_race_no    ON historical_alternative_odds (race_no);
CREATE INDEX idx_hao_combination ON historical_alternative_odds (combination);
CREATE INDEX idx_hao_source     ON historical_alternative_odds (source_type, source_quality);
```

---

## カラム定義

| カラム | 型 | NOT NULL | DEFAULT | 説明 |
|---|---|:---:|---|---|
| id | INTEGER | ✅ | AUTOINCREMENT | 主キー |
| race_id | TEXT | ✅ | — | decision_history.race_id と JOIN 可能 |
| race_date | TEXT | ✅ | — | YYYY-MM-DD |
| venue | TEXT | ✅ | — | 場名 |
| venue_code | TEXT | ✅ | — | 2桁場コード (01〜24) |
| race_no | INTEGER | ✅ | — | レース番号 |
| combination | TEXT | ✅ | — | 1-2-3 / 1-3-2 / 1-2-4 / 1-4-2 / 1-3-4 |
| odds | REAL | ✅ | — | 取得オッズ値 |
| source_type | TEXT | ✅ | official_archive | データソース種別 |
| source_quality | TEXT | ✅ | historical_closing_odds | live/timeseries と区別するラベル |
| source_url | TEXT | ✅ | — | 取得元 URL |
| fetched_at | TEXT | ✅ | — | ISO8601 取得日時 |
| parser_version | TEXT | ✅ | 1.0 | パーサーバージョン |
| is_backfill | INTEGER | ✅ | 1 | 常に 1 (後日補完フラグ) |
| fetch_status | TEXT | ✅ | success | success / fetch_error / parse_error / no_odds_found |
| notes | TEXT | — | NULL | 備考 |

## ユニーク制約

```sql
-- 同一レース×買い目×ソース種別の重複を防ぐ
CREATE UNIQUE INDEX uq_historical_alternative_odds_key
  ON historical_alternative_odds (race_id, combination, source_type, source_quality);
```

## インデックス案

| インデックス | カラム | 目的 |
|---|---|---|
| uq_key | race_id, combination, source_type, source_quality | UNIQUE / 重複防止 |
| idx_race_id | race_id | decision_history との JOIN |
| idx_race_date | race_date | 期間フィルター |
| idx_venue | venue | 会場別集計 |
| idx_race_no | race_no | raceNo別集計 |
| idx_combination | combination | 買い目別集計 |
| idx_source | source_type, source_quality | ソース種別フィルター |

---

## backfill 優先順位

| 優先度 | 区分 | n | 理由 |
|---|---|---:|---|
| A | 条件B該当 | 167 | switch検証の主対象 |
| B | 6R | 215 | skip候補の検証 |
| C | 浜名湖+住之江 | 159 | skip候補の検証 |
| D | 6R+浜名湖+住之江 | 374 | 重複含む |
| E | その他のforward BUY | 1046 | 全体 backfill |

---

## 注記（必須）

- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない
- 事前代替 odds 不足のため switch 本採用不可
- **historical closing odds backfill ができても live/T-5 forward ではない**
- 現時点で採用可能なのは skip monitor のみ
- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可
- historical closing odds で良くても、live/T-5 odds で未検証なら switch 本採用不可
- switch は必ず future-only odds_timeseries で再確認する

---
*生成: design-historical-alternative-odds-storage.ts*