# 選手能力データの安全利用ルール（品質ゲート）

作成: 2026-06-13（データ基盤監査パックの成果物）
根拠: `reports/racer-ability-data-audit.md`（`pnpm report:racer-ability-audit` で再生成）

2026-07-23のPhase N0統合監査は
[`../reports/all-bet-type-data-feasibility.md`](../reports/all-bet-type-data-feasibility.md)
とmachine-readable JSONの`racerAudit`を正本とする。特に、対象race・同日後続raceの結果除外、現在値fallback禁止、`fetched_at`と有効時点の分離を優先する。

このドキュメントは「選手能力データを分析・検証に使う前に必ず通すゲート」を定める。
**BUY条件作成・ROI探索・decision logic変更の許可を与えるものではない。**

## 1. 特徴量の安全分類（2026-06-13 時点）

### usable_for_historical（historical backtest に使ってよい）

| 特徴量 | ソース | decision使用 |
|---|---|---|
| className (A1/A2/B1/B2) | official_programs.raw_json boats[] | 使用中 |
| nationalWinRate | 同上 | 使用中 |
| nationalTop2Rate | 同上 | 未使用 |
| localWinRate | 同上 | 使用中 |
| localTop2Rate | 同上 | 未使用 |
| motorTop2Rate（全国） | 同上 | 使用中（fallback） |
| boatTop2Rate（全国） | 同上 | 使用中（fallback） |
| venueMotorTop2Rate / venueBoatTop2Rate | motor_boat_stats | 使用中 |

理由: いずれも出走表（前売り時点で公表）に印刷された当時の値をレース日キー付きで保存しており、
レース当時に利用可能だった情報である。
注意: motor_boat_stats は **2024-01-01 以降のみ**。2023以前の historical 検証に使う場合は
raw_json の全国値のみ使うか、needs_backfill として扱う。

### usable_for_live_only（live／forward でのみ使ってよい）

| 特徴量 | ソース | decision使用 |
|---|---|---|
| avg_st（全コース平均ST） | racer_profiles | 未使用 |
| ability_index | racer_profiles | 未使用 |
| flying_count / late_start_count | racer_profiles | 未使用 |
| courseAvgSt / courseTop3Rate | racer_course_stats | **使用中（courseStFactor / courseTop3Factor）** |
| courseEntryRate / courseStartOrder | racer_course_stats | 未使用 |
| exhibitionStResidual | exhibition_data − racer_course_stats.avg_st | **使用中** |

理由: racer_profiles / racer_course_stats は **現在値スナップショット1世代のみ**
（fetched_at 2026-05-29〜06-08、distinct fetch days = 3）。snapshot 履歴を持たない。

### unsafe_due_to_point_in_time_leakage（historical 検証に使うと未来情報リーク）

上記 live-only 群すべて。過去レースに当てた時点でリークになる。

**実害の証拠**: `server/db.ts` の `enrichFeatures` は registrationNo+course のみで JOIN し
日付条件がないため、historical-backfill を再生成すると過去レースに現在値が注入される。
decision_history の historical-backfill 行のうち feature_adjustment_breakdown を持つ
1,969行（2025-01-01〜01-12）中 **1,938行で courseStFactor / courseTop3Factor が非中立**。
これは 2026-05/06 取得のコース別成績が 2025-01 のレースに適用された証拠である。

→ **historical-backfill の再生成・再評価を行う際は、courseStFactor / courseTop3Factor /
exhibitionResidualFactor が混入していないか（または全行で中立=1か）を必ず確認すること。**
2018〜2024 の既存 BUY 6,276件の大半は breakdown 列追加前の生成であり、当時の生成時点で
racer_course_stats が空だった可能性が高い（=中立）が、再生成すると汚染される。

### missing_or_low_coverage / needs_schema_change

| 特徴量 | 状態 |
|---|---|
| nationalTop3Rate / localTop3Rate | DBにも raw_json にも存在しない。取得元の追加が必要 |
| motor_boat_stats 2023以前 | needs_backfill（Kアーカイブ再パースで補える可能性。data-roadmap 参照） |
| 期別スナップショット全般 | needs_schema_change（docs/racer-point-in-time-feature-plan.md 参照） |

## 2. 品質ゲート（分析前チェックリスト）

選手能力データを使う分析・検証を始める前に、必ず以下を通す:

1. `pnpm report:racer-ability-audit` を実行し、最新の coverage / leakEvidence を確認する
2. 使う特徴量が上の分類で **usable_for_historical** に入っているか確認する
   - live-only 特徴量を historical に使う場合は、その分析を **却下** する
3. coverage ゲート:
   - 対象母集団で **coverage >= 95%** を必須とする（95%未満は missing_or_low_coverage として結果に明記）
   - coverage 80%未満の特徴量は分析自体を行わない（欠損パターンがレース格・会場と相関し選択バイアスになるため）
4. 鮮度ゲート（live利用時）:
   - racer_profiles / racer_course_stats は **fetched_at がレース日から90日以内** を鮮度OKとする
     （級別・期別成績は半年ごとに更新されるため、90日超は前期データの可能性が高い）
   - 90日超は stale として live 判定の補正から外す（= null 扱い）
5. null / unknown の扱い:
   - 補正係数は **欠損時に中立(=1)** とする（programFeatures.ts の既存実装と同じ）
   - 欠損を「平均値で埋める」「0で埋める」ことは禁止
6. 欠損が BUY 判定を歪めるリスクの警告:
   - BUY 候補のうち補正係数が欠損起因で中立になっている割合を報告に含める
   - 欠損率が母集団間で 5pt 以上違う場合（例: 訓練期 vs forward期）、比較自体に警告を付ける

## 3. historical 検証で許可される条件（まとめ）

- 使う特徴量がすべて usable_for_historical
- coverage >= 95%（対象母集団で実測）
- 特徴量の値が「レース日以前に確定していた」ことをソース構造で説明できる
- 2023以前を含む場合、motor_boat_stats 由来の値を使わない（または backfill 完了後）

## 4. live-only で許可される条件

- fetched_at がレース日から90日以内
- 現在値スナップショットであることを結果に明記
- live で得た知見を「そのまま historical に外挿しない」ことを明記

## 5. コードレベルの実施状況（2026-06-13 実装済み）

以下は設計案ではなくコードに入った実装である。

| パス | 実施内容 |
|---|---|
| `server/db.ts enrichFeatures` | `mode` パラメータ追加。`"historical"/"historical-readonly"` では live-only 特徴量を注入しない（racer_profiles/racer_course_stats JOIN なし） |
| `listProgramInputsRange` | デフォルト `"historical-readonly"`（明示しなければ安全） |
| `listProgramInputsWithOddsSnapshotsRange` | デフォルト `"historical"` |
| `src/domain/programFeatureSafety.ts` | `stripLiveOnlyRacerFeatures` / `assertNoLiveOnlyFeaturesForHistorical` / `assertBreakdownNeutralForHistorical` |
| `scripts/generate-decision-history.ts` | historical guard 追加: 生成前に上記 assert を実行。混入があれば即 throw |
| `scripts/analyze-regenerated-ab.ts` | 独自の `loadCourseStats/loadProfiles/loadExhibitionSt` を削除、`stripLiveOnlyRacerFeatures` に置換 |
| `scripts/check-point-in-time-safety.ts` | 静的スキャン: 許可リスト外でのライブonly特徴量注入を error、直接 JOIN を warning として出力。`pnpm check:point-in-time-safety` で実行 |

## 6. 監査コマンド

```bash
pnpm report:racer-ability-audit     # この監査（coverage / leak証拠 / 分類）
pnpm stats:racer-coverage           # racer_profiles / racer_course_stats の充足率
pnpm report:racer-freshness         # 鮮度レポート
pnpm check:point-in-time-safety     # 静的スキャン（exit 0 = error なし）
```
