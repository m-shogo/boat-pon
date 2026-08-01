# N2 Feature Point-in-Time (PIT) Contract

更新: 2026-08-02
状態: 設計＋enforcement（既存 `programFeatureSafety.ts` を N2 へ統合）
enforcement: [`../src/research-replay/n2DatasetContract.ts`](../src/research-replay/n2DatasetContract.ts) `validateFeaturePIT`、既存 [`../src/domain/programFeatureSafety.ts`](../src/domain/programFeatureSafety.ts)、既存 gate [`racer-ability-feature-safety.md`](racer-ability-feature-safety.md)

## 原則

feature は `available_at <= decision_cutoff`（通常 race lock time）を満たす場合のみ使用可。**race date だけで安全判定しない**（同日後続 race や post-race 更新の逆流を防ぐ）。`available_at` 不明は **fail-closed（除外）**。同一 millisecond は inclusive。

oddsはkind判定と時刻判定を分離しない。`validateOddsUsage`へ`kind / role / capturedAt / availableAt / decisionCutoff`を同時に渡し、live checkpointではcapture/availabilityの双方がcutoff以下、かつavailabilityがcapture以下であることを強制する。closingは妥当な時刻を持つ価格評価専用で、feature/decisionには使用しない。contract versionは`n2-feature-pit-contract-v2`。

`n2FeatureDatasetBuilder.ts`は両PIT guardをselection-level build pathへ接続済み。既知のlive-only keyはnamespaced keyでもcallerがclassを偽装できず、unsafeなfeature/oddsが一つでもあればcandidate全体を0行でfail-closedにする。`n2FeatureLineage.ts`はF0 observation/parse/rawのread-only JOINと証拠鎖検証を実装し、`n2FeatureSourceAdapter.ts`はverified lineage以外を拒否する。F0 typed observation registryにはstrictな`official_program` pre-race payload契約を追加済みで、canonical join identityは`YYYY-MM-DD:venue:RraceNo`に固定した。`n2OfficialProgramObservation.ts`でsource時刻順序とprimary rawを正規化し、coverage readerはtyped payloadのschema/hash/identity/observed_atとprimary semantic値の一致も要求する。実collectorによるsidecar observation生成と全券種market observationは未整備のため、実join/coverageは引き続き未確認。

coverage/provenanceは`n2FeatureCoverage.ts`で年代・feature・odds selection別に集計する。分母はrace×source kind×keyで固定し、未検証lineageを黙ってdropしない。実eventが0件なら`PENDING_REAL_DATA`となり、coverage 0%を実測結果として昇格しない。

## Feature 分類（既存 `programFeatureSafety.ts` を継承）

| class | 例（feature key） | source | N2 historical 使用 |
|---|---|---|---|
| `historical_safe` | className, nationalWinRate, nationalTop2Rate, localWinRate, localTop2Rate, motorTop2Rate, boatTop2Rate, venueMotorTop2Rate, venueBoatTop2Rate | official_programs.raw_json（出走表）+ motor_boat_stats | source availability + immutable observation/raw lineageがありcutoff以前の場合のみ使用可。race日/imported_atだけでは不可 |
| `live_only` | courseAvgSt, courseTop3Rate, courseEntryRate, courseStartOrder, flyingCount, lateStartCount, exhibitionStResidual | racer_profiles / racer_course_stats（現在値スナップショット1世代） | **historical では常に除外**（`validateFeaturePIT` が `excluded_live_only_in_historical`） |
| `odds_timed` | trifecta_market / current_odds / closing odds | odds snapshot | timing で分岐（[`n2-data-contracts.md`](n2-data-contracts.md) §4） |
| `unknown` | available_at 不明の任意 feature | — | **fail-closed 除外** |

- 既知 leak 証拠（[`racer-ability-feature-safety.md`](racer-ability-feature-safety.md)）: `server/db.ts enrichFeatures` は registrationNo+course のみで JOIN し日付条件がないため、historical-backfill 再生成で過去 race に現在値が注入される（decision_history 1,969行中1,938行で courseStFactor 非中立）。→ N2 は `mode="historical"` + `stripLiveOnlyRacerFeatures` / `assertNoLiveOnlyFeaturesForHistorical` を必須にする。
- coverage/freshness gate（既存）: historical は該当母集団で coverage≥95%、live は fetched_at がrace日から90日以内。欠損は中立(=1)、平均/0 埋め禁止。

## Same-day leakage（PHASE 6）

ボートレースは同一会場・同一選手で同日複数 race がある。方向性を固定:

- 使用可（例）: R1 の確定結果 → R5 予測（R5 の decision_cutoff 時点で R1 は確定済み）。
- **leakage（禁止）**: R5 終了後に更新された daily aggregate → R1 training feature。
- したがって集計 feature は「その集計の available_at（= 集計対象最終 race の確定時刻、または snapshot 時刻）」を持ち、`available_at <= 対象 race の decision_cutoff` を満たす場合のみ使用。final-day 集計を同日全 race の feature に使わない。
- event-time ordering は canonical_race_key（date:venue:raceNo）+ scheduled_start + venue local date を基準にする。ingestion time / DB update time は available_at として使わない（後追い更新のため）。

## Reproducibility manifest（PHASE 9）

dataset は同一 manifest で完全再生成可能にする。manifest 必須項目:

- dataset_version / code SHA / feature_contract_version / target_contract_version
- N1 schema checksums（0.1 `35903ee1…` / 0.2 `50d7e605…` / 0.3 `94c73e24…`）
- canonical resolution version（`n1c-source-duplicate-resolver-v1`）
- archive manifest SHA / source fingerprints
- PIT cutoff policy / date range / included rows / excluded rows by reason

prototype（`prototype-n2-dataset.ts`）で label digest の決定的再生成一致を確認済み（`deterministicRebuild=true`）。

## Adversarial leakage tests

`n2DatasetContract.test.ts` で固定:
- available_at == cutoff（inclusive 許可）/ < cutoff（許可）/ > cutoff（`excluded_pit_after_cutoff`）
- available_at 不明 → `excluded_pit_unknown_availability`（fail-closed）
- live_only feature を historical で使用 → `excluded_live_only_in_historical`
- post-race settlement-derived feature（cutoff 後 available）→ 除外
- closing/post_race odds を feature role → 拒否、evaluation role → closing のみ許可
- live checkpointのcapturedAt/availableAtがcutoffより1msでも未来 → 拒否
- availableAt > capturedAt、時刻欠損、不正timestamp → reason code付きfail-closed
- 既存 static scan `pnpm check:point-in-time-safety` を N2 dataset build 前に必須化する。
