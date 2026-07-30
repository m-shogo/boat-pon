# N2 Data Contracts — dataset / target / settlement-label / odds-timing

更新: 2026-07-30
状態: **設計＋enforcement 実装（model training は未着手）**
enforcement: [`../src/research-replay/n2DatasetContract.ts`](../src/research-replay/n2DatasetContract.ts)（純関数、tests: `n2DatasetContract.test.ts`）
label source: N1 canonical **active** settlement（`source_duplicate` 除外・`resolved` のみ）

## 1. Training Dataset Contract

- **dataset unit**: 1 (race × bet_type × bet_selection)。行 = 「ある race のある券種のある買い目」。
- **primary key**: (canonical_race_key, bet_type, bet_selection, dataset_version)。
- **required fields**: race identity（canonical_race_key, venue_code, race_no, scheduled_start）/ feature observed_at・available_at / decision_cutoff(=race lock) / canonical settlement（winning selections, payout_yen）/ target / eligibility + exclusion_reason / odds observation time / provenance(observation_id, raw_document_id, schema versions) / dataset_version。
- **inclusion/exclusion**（fail-closed、理由コード必須。「黙って drop」禁止）— `classifyEligibility`:

| settlement/resolution 状態 | 判定 | reason code |
|---|---|---|
| settled + resolved + not source_duplicate | 採用 | `eligible` |
| partially_refunded + resolved | 採用（hit/miss は payout line で成立、refund は financial 側） | `eligible` |
| refunded（全返還） | 除外 | `excluded_refunded` |
| cancelled | 除外 | `excluded_cancelled` |
| no_sale | 除外 | `excluded_no_sale` |
| pending | 除外 | `excluded_unsettled` |
| resolution=source_conflict | 除外 | `excluded_conflict` |
| resolution=unresolved/quarantined | 除外 | `excluded_unresolved` |
| source_duplicate（canonical 無効化） | 除外 | `excluded_source_duplicate` |
| 上記外・未知 | 除外 | `excluded_unknown` |

- 実測分布（`../reports/n2/n2-dataset-profile.json`）: 全 8,156,795 candidate 中 **eligible 7,833,298（96.03%）**、excluded_refunded 319,301、excluded_source_duplicate 4,196。

## 2. Target Contract

raw truth を直接 target にしない。canonical active settlement からのみ導出（`deriveBetLabel`）。段階分離:
`base predictive target（hit 確率）→ calibration → market odds → expected value → decision policy`。決定を直接 target にしない（既存 policy への過学習回避）。

| target | 定義 | source | 備考 |
|---|---|---|---|
| `hit`（classification） | bet_selection ∈ canonical winning selections → 1/0 | payout line canonical | ineligible は **null（loss 扱い禁止）** |
| `payoutYenPer100`（financial） | hit 時の払戻（100円あたり）、miss は 0 | payout_yen | refund は財務 target 側で別扱い |

- 券種別 semantics: win/place=艇番、exacta/quinella/wide=2艇、trifecta/trio=3艇（順序あり/なしは N1 canonical に従う）。同着は複数 winning selection（`deriveBetLabel` は複数一致で hit=1・該当 payout を採用）。
- class balance（実測、eligible 比率）: win 99.95% / place 97.45% / exacta 95.03% / quinella 95.03% / trifecta 94.92% / trio 95.02% / wide 95.05%（refund 率が多艇券種で高い）。hit 率自体は券種で大きく異なる（trifecta ≪ win）ため **券種別 target/calibration を必須**とする。

## 3. Settlement → Label Contract（fail-closed）

- **canonical active** のみ使用（`source_duplicate` は label を二重計上しない — active view で除外済み、resolved 624）。
- revision: 現行 canonical resolution を使用、reproducibility のため schema/resolution version を manifest に固定。
- refund: hit/miss target と financial-return target で意味を分ける（refund を miss/loss にしない）。
- cancel/no_sale: label 不成立（除外）。unsettled/conflict/unknown: fail-closed 除外。
- state fixture は `n2DatasetContract.test.ts` で固定（settled→eligible、各除外理由、ineligible→null）。

## 4. Odds Timing Contract（`validateOddsUsage`）

| role | 使用可 odds | 禁止 |
|---|---|---|
| feature（training） | live_checkpoint（cutoff 以前） | closing / post_race_imputed / unknown |
| evaluation（価格評価専用） | closing / live_checkpoint | post_race_imputed / unknown |
| decision | 意思決定時点で available な odds | closing / post_race |

- final/closing odds を **training feature に入れない**。closing は「価格評価専用」と明示。
- 既知バイアス（CLAUDE.md）: `current_odds` は締切前暫定で約14.94pt の楽観バイアス、gap≥10pt では current_odds 判断を信頼しない。実払戻（N1 `payout_yen`）を label/財務評価の主基準にする。

## 5. 温度・coverage 制約（N2 が前提にすること）

- **temporal coverage gap**: local archive は **2001–2003 が欠落**、2000 は部分（131 files）。usable historical range は実質 **2004–2026（+部分2000）**。詳細 `../docs/missing-dates.md` / `../reports/n2/n2-dataset-profile.json`。
- **eligibility drift**: eligible 比率が 2004–2006 ≈87% → 2020+ ≈99.9% と drift（早期の返還/除外率が高い）。N2 の split/評価は era drift を考慮する（[`n2-evaluation-and-split.md`](n2-evaluation-and-split.md)）。
