# データロードマップ

boat-pon が予測精度向上のために収集・利用したいデータの整理。

**大前提**
- **自動投票は絶対に禁止**（本ファイルはデータ収集の設計書であり、投票処理とは無関係）
- **外部サイトへの大量アクセスは禁止**（1レースあたり1〜2リクエスト以内、ポーリング間隔10分以上）
- **取得済みデータはキャッシュ前提**（SQLite に保存し、同一 race_id の再取得は原則スキップ）
- DBやライブ設定を変更する処理は `docs/settings-change-gate.md` のゲートを通すこと

---

## 1. 結果データ

| 項目 | 内容 |
|------|------|
| **目的** | モデルのヒット率・ROIを実測し、エッジの有無を検証する |
| **重要度** | ★★★ 最重要（これがないと何も検証できない） |
| **保存テーブル** | `race_results` |
| **保存カラム** | `race_id`, `date`, `venue`, `race_no`, `trifecta`（3連単出目）, `payout_yen`（払戻金額）, `popularity`（人気順位）, `returned`（返還フラグ） |
| **利用タイミング** | レース終了後（当日21:30バッチ）に取得し `decision_history` のhit判定に使う |
| **現在の状態** | ✅ OK — `race_results` に約117万件。2020年以降ほぼ網羅 |
| **注意点** | 返還レース（`returned=1`）はROI計算の分母から除外すること。払戻は胴元手数料込みなので ROI ÷ 0.75 が実質倍率 |

---

## 2. 締切直前オッズ

| 項目 | 内容 |
|------|------|
| **目的** | CLV（Closing Line Value）の算出。早期オッズ → 締切直前オッズの変化を見て市場の「ズレ」を検出する |
| **重要度** | ★★★ 高（sharp money signal の唯一の源泉） |
| **保存テーブル** | `odds_snapshots`（最新値互換）+ `odds_timeseries_snapshots`（append-only設計） |
| **保存カラム** | `race_id`, `selection`, `odds`, `popularity`（人気順位）, `captured_at`, `is_final_like`（締切5分前フラグ）。時系列側は `minutes_before_close`, `checkpoint_label`（T-30/T-20/T-10/T-5）も保持 |
| **利用タイミング** | レース締切30分前〜5分前に取得。`is_final_like=1` が締切直前スナップショット |
| **現在の状態** | ✅ OK — `is_final_like=1` で約27万件。2026年ライブ分は97%カバー |
| **注意点** | `sharp_signal_drop`（早期→終値の下落率）は `decision_history` に保存済みだがテスト期間(2025)は未収集。ライブ蓄積が必要。既存 `odds_snapshots` は互換維持のため最新値中心、`auto:odds` は append-only の `odds_timeseries_snapshots` にも全120通りを保存する。CLV/late money検証は時系列側を使う |

---

## 3. 現在オッズと必要オッズの差（オッズ比）

| 項目 | 内容 |
|------|------|
| **目的** | `current_odds / required_odds` の比率（ratio）でモデルと市場の乖離を定量化。ratio<1.5 が採用基準 |
| **重要度** | ★★★ 高（現在の主要フィルター） |
| **保存テーブル** | `decision_history`（派生値として記録。`run_kind` で paper-live / historical-backfill / manual-test / sample を区別） |
| **保存カラム** | `current_odds`（市場オッズ）, `required_odds`（EV目標を達成するための最低オッズ）, `ev`（期待値） |
| **利用タイミング** | BUY/WATCH/SKIP判定時にリアルタイム計算。`decision_history` に保存 |
| **現在の状態** | ✅ OK — `decision_history` に両カラム存在。ratio はクエリ時に `current_odds/required_odds` で計算 |
| **注意点** | ratio の専用カラムはなし（都度計算）。分析クエリでは `NULLIF(required_odds, 0)` でゼロ除算を防ぐこと |

---

## 4. 天候・風・波

| 項目 | 内容 |
|------|------|
| **目的** | 風速・波高・安定板使用を把握し、荒天レースを除外または補正する |
| **重要度** | ★★ 中（外れ値の除去に有効。荒天はモデル外の変数が増えROI悪化） |
| **保存テーブル** | `race_weather` |
| **保存カラム** | `race_id`, `weather`（天候文字列）, `wind_speed_mps`, `wave_height_cm`, `temperature_c`, `water_temperature_c`, `stable_plate`（安定板フラグ）, `shortened_laps`（周回短縮フラグ） |
| **利用タイミング** | 展示情報（beforeinfo）取得時に同時収集。BUY候補の `environment_risk_level` 判定に使う |
| **現在の状態** | ⚠️ PARTIAL — `race_weather` は2026年ライブ分を蓄積中 |
| **注意点** | `scripts/fetch-exhibition.ts` / `scripts/auto-fetch-exhibition.ts` が公式直前情報（beforeinfo）から展示・天候・装備を同時取得する。外部サイトへのポーリングは最低10分間隔を守ること |

---

## 5. 展示タイム

| 項目 | 内容 |
|------|------|
| **目的** | 展示タイム（ラップタイム）とスタートタイミング（ST）の残差を算出し、当日コンディションを反映した調整を行う |
| **重要度** | ★★ 中（`exhibitionStResidual` としてモデルに組み込み済みだが収集が疎） |
| **保存テーブル** | `exhibition_data` |
| **保存カラム** | `race_id`, `course`（1〜6コース）, `exhibition_time`（秒）, `start_timing`（ST秒）, `ranking`（展示順位）, `fetched_at` |
| **利用タイミング** | 締切30〜15分前に取得し `featureAdjustmentForSelection` 内の `exhibitionST` 補正に使う |
| **現在の状態** | ⚠️ PARTIAL — 2026年ライブ分の一部のみ収集。自動取得スクリプト(`auto-fetch-exhibition.ts`)が稼働中だが網羅率改善中 |
| **注意点** | `exhibition_st_residual_sum` は `decision_history` に保存済みだがテスト期間(2025)は未収集。有効性の歴史検証不可 |

---

## 6. チルト・部品交換

| 項目 | 内容 |
|------|------|
| **目的** | チルト角（エンジン推進力に影響）・モーター部品交換（整備効果）を把握し、当日コンディションの突発変化を捉える |
| **重要度** | ★ 低〜中（理論的には有効だが、モーター成績(top2rate)で代替できる部分が多い） |
| **保存テーブル** | `race_equipment` |
| **保存カラム** | `race_id`, `course`, `tilt_angle`, `propeller_changed`, `parts_changed`（JSON配列）, `parts_changed_count`, `fetched_at` |
| **利用タイミング** | 公式直前情報（beforeinfo）取得時に展示・天候と同時収集する |
| **現在の状態** | ⚠️ PARTIAL — テーブルと取得処理は実装済み。2026年ライブ分をこれから蓄積 |
| **注意点** | チルトはレース直前まで変更されることがある。まずは特徴量として蓄積し、n=300到達までは自動ルール採用しない |

---

## 7. モーター/ボート成績

| 項目 | 内容 |
|------|------|
| **目的** | モーター2連率・ボート2連率を把握し、機材コンディションの差をモデルに組み込む |
| **重要度** | ★★ 中（`candidateMotorTop2Rate` / `candidateBoatTop2Rate` として既にフィルターで参照可能） |
| **保存テーブル** | `official_programs.raw_json`（boats[].motorTop2Rate / boatTop2Rate として埋め込み）+ `racer_profiles`（選手成績）+ `racer_course_stats`（コース別成績） |
| **保存カラム** | raw_json内: `motorNo`, `motorTop2Rate`, `boatNo`, `boatTop2Rate` / `racer_profiles`: `top3_rate`, `avg_st`, `ability_index`, `flying_count`, `late_start_count` |
| **利用タイミング** | 番組取得時に raw_json として保存済み。`programFeatures.ts` がパース時に使用 |
| **現在の状態** | ✅/⚠️ 移行中 — 新規取り込み時に `motor_boat_stats` へ正規化。既存 `official_programs.raw_json` は `npm run backfill:motor-boat-stats` で補完可能 |
| **注意点** | `motor_boat_stats` によりJSON解析なしで会場別・モーター別・ボート別ROI集計が可能。既存データ補完はまず `--dry-run` と小さい `--limit` で確認する |

---

## 優先度サマリー

| # | データ種別 | 現状 | 優先度 | 次のアクション |
|---|-----------|------|--------|--------------|
| 1 | 結果データ | ✅ OK | — | 現状維持 |
| 2 | 締切直前オッズ | ✅ OK | — | 現状維持 |
| 3 | オッズ比（派生） | ✅ OK | — | 現状維持 |
| 4 | 天候・風・波 | ⚠️ PARTIAL | ★★ | auto-fetch-exhibition の安定稼働 |
| 5 | 展示タイム | ⚠️ PARTIAL | ★★ | 同上 |
| 6 | チルト・部品交換 | ⚠️ PARTIAL | ★ | beforeinfo取得で蓄積→n=300以降に判断 |
| 7 | モーター/ボート成績 | ⚠️ PARTIAL | ★ | 専用テーブル化は将来課題 |
