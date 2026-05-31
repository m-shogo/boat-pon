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
| **保存テーブル** | `odds_snapshots` |
| **保存カラム** | `race_id`, `selection`, `odds`, `popularity`（人気順位）, `captured_at`, `is_final_like`（締切5分前フラグ） |
| **利用タイミング** | レース締切30分前〜5分前に取得。`is_final_like=1` が締切直前スナップショット |
| **現在の状態** | ✅ OK — `is_final_like=1` で約27万件。2026年ライブ分は97%カバー |
| **注意点** | `sharp_signal_drop`（早期→終値の下落率）は `decision_history` に保存済みだがテスト期間(2025)は未収集。ライブ蓄積が必要 |

---

## 3. 現在オッズと必要オッズの差（オッズ比）

| 項目 | 内容 |
|------|------|
| **目的** | `current_odds / required_odds` の比率（ratio）でモデルと市場の乖離を定量化。ratio<1.5 が採用基準 |
| **重要度** | ★★★ 高（現在の主要フィルター） |
| **保存テーブル** | `decision_history`（派生値として記録） |
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
| **現在の状態** | ⚠️ PARTIAL — `race_weather` は47件のみ。2026年ライブ分のみ蓄積中 |
| **注意点** | `scripts/fetch-exhibition.ts` が天候も同時取得する設計だが、自動実行スクリプトへの組み込みが未完。外部サイトへのポーリングは最低10分間隔を守ること |

---

## 5. 展示タイム

| 項目 | 内容 |
|------|------|
| **目的** | 展示タイム（ラップタイム）とスタートタイミング（ST）の残差を算出し、当日コンディションを反映した調整を行う |
| **重要度** | ★★ 中（`exhibitionStResidual` としてモデルに組み込み済みだが収集が疎） |
| **保存テーブル** | `exhibition_data` |
| **保存カラム** | `race_id`, `course`（1〜6コース）, `exhibition_time`（秒）, `start_timing`（ST秒）, `ranking`（展示順位）, `fetched_at` |
| **利用タイミング** | 締切30〜15分前に取得し `featureAdjustmentForSelection` 内の `exhibitionST` 補正に使う |
| **現在の状態** | ⚠️ PARTIAL — 665件のみ。2026年ライブ分の一部のみ収集。自動取得スクリプト(`auto-fetch-exhibition.ts`)が稼働中だが網羅率低い |
| **注意点** | `exhibition_st_residual_sum` は `decision_history` に保存済みだがテスト期間(2025)は未収集。有効性の歴史検証不可 |

---

## 6. チルト・部品交換

| 項目 | 内容 |
|------|------|
| **目的** | チルト角（エンジン推進力に影響）・モーター部品交換（整備効果）を把握し、当日コンディションの突発変化を捉える |
| **重要度** | ★ 低〜中（理論的には有効だが、モーター成績(top2rate)で代替できる部分が多い） |
| **保存テーブル** | **なし（未実装）** |
| **保存カラム** | 案: `tilt_angle` (REAL), `part_changed` (TEXT, 例: "キャブレター,電気系"), `part_changed_count` (INTEGER) |
| **利用タイミング** | 番組取得時（直前情報ページ）に同時収集できれば理想 |
| **現在の状態** | ❌ MISSING — 専用テーブル・カラムなし |
| **注意点** | 公式直前情報ページ（beforeinfo）から取得可能だが、チルトはレース直前まで変更されることがある。収集タイミングが重要。外部サイトへの追加アクセスが発生するため導入前にアクセス頻度を確認すること |

---

## 7. モーター/ボート成績

| 項目 | 内容 |
|------|------|
| **目的** | モーター2連率・ボート2連率を把握し、機材コンディションの差をモデルに組み込む |
| **重要度** | ★★ 中（`candidateMotorTop2Rate` / `candidateBoatTop2Rate` として既にフィルターで参照可能） |
| **保存テーブル** | `official_programs.raw_json`（boats[].motorTop2Rate / boatTop2Rate として埋め込み）+ `racer_profiles`（選手成績）+ `racer_course_stats`（コース別成績） |
| **保存カラム** | raw_json内: `motorNo`, `motorTop2Rate`, `boatNo`, `boatTop2Rate` / `racer_profiles`: `top3_rate`, `avg_st`, `ability_index`, `flying_count`, `late_start_count` |
| **利用タイミング** | 番組取得時に raw_json として保存済み。`programFeatures.ts` がパース時に使用 |
| **現在の状態** | ⚠️ PARTIAL — モーター/ボート成績は `official_programs.raw_json` に約113万件あり実質カバー済み。ただし専用インデックステーブルなし（JSON解析で対応）。`racer_profiles` は2644件で選手単位のF数・ST平均を保持 |
| **注意点** | 専用テーブルがないため、モーター成績単独での集計クエリが重い。将来的に `motor_stats (motor_no, period, top2_rate)` テーブルを設けるとクエリ効率が上がる |

---

## 優先度サマリー

| # | データ種別 | 現状 | 優先度 | 次のアクション |
|---|-----------|------|--------|--------------|
| 1 | 結果データ | ✅ OK | — | 現状維持 |
| 2 | 締切直前オッズ | ✅ OK | — | 現状維持 |
| 3 | オッズ比（派生） | ✅ OK | — | 現状維持 |
| 4 | 天候・風・波 | ⚠️ PARTIAL | ★★ | auto-fetch-exhibition の安定稼働 |
| 5 | 展示タイム | ⚠️ PARTIAL | ★★ | 同上 |
| 6 | チルト・部品交換 | ❌ MISSING | ★ | テーブル設計→n=300以降に判断 |
| 7 | モーター/ボート成績 | ⚠️ PARTIAL | ★ | 専用テーブル化は将来課題 |
