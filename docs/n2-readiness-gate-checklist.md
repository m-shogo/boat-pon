# N2 Readiness Gate Checklist（着手前・設計のみ）

更新: 2026-07-30
状態: **N2 未着手（model/training/tuning は行わない）**

N1-C（全券種 settlement canonical 基盤）完成を受け、N2（市場残差/選手能力等を用いた予測・評価フェーズ）へ進む前に満たすべき gate を、repo・docs・schema・reports から整理する。本書は checklist であり、N2 実装・training・BUY/WATCH/SKIP・threshold 変更・production 接続は一切行わない。

## N1 が N2 へ提供するもの（READY）

| 項目 | 状態 | 根拠 |
|---|---|---|
| settlement truth（全7券種、payout/refund/status） | READY | 8,170/8,170、candidates 8.16M、integrity ok/fk 0 |
| canonical active view（重複排除済み） | READY | active canonical race-level uniqueness=0、source_duplicate resolution |
| raw provenance / evidence lineage | READY | capture→raw→parse→observation→candidate、append-only、raw immutable |
| post-race leakage boundary | READY | observation type=post_race（leakage sentinel test） |
| revision/refund/cancellation/conflict の表現 | READY | status axis（settled/refunded/partially_refunded/cancelled/no_sale/pending）、conflict group、revision kind |
| reproducibility（決定的再構築） | READY | source archive immutable＋deterministic backfill/resolution |
| value 整合（legacy 照合） | READY | payout mismatch 0（sample 2,000） |

## N2 readiness gate（2026-07-30 audit、A–N）

design/contract/enforcement/prototype を実装（[`n2-data-contracts.md`](n2-data-contracts.md) / [`n2-feature-pit-contract.md`](n2-feature-pit-contract.md) / [`n2-evaluation-and-split.md`](n2-evaluation-and-split.md) / `src/research-replay/n2DatasetContract.ts` + tests / `reports/n2/n2-dataset-profile.json`）。

| gate | 状態 | 根拠 |
|---|---|---|
| A. canonical settlement truth | **READY** | 8,170/8,170、integrity ok/fk 0、active uniqueness=0 |
| B. training dataset contract | **READY** | `classifyEligibility`（fail-closed、理由コード）、eligible 96.03% 実測 |
| C. target definition | **READY** | `deriveBetLabel`（hit/financial 分離・券種別・同着・ineligible→null） |
| D. feature PIT | **READY(enforcement) / PARTIAL(feature 接続)** | `validateFeaturePIT` + 既存 `programFeatureSafety.ts`。実 feature build 接続は N2 実装時 |
| E. odds PIT/timing | **READY** | `validateOddsUsage`（feature=live_checkpoint のみ、closing=eval 専用） |
| F. unresolved settlement handling | **READY** | fail-closed 除外（conflict/unresolved/refund/cancel/source_duplicate） |
| G. dataset reproducibility | **READY** | manifest 契約 + prototype 決定的再生成一致 |
| H. split policy | **READY(設計)** | time-based・race-level group・coverage gap/era drift 尊重 |
| I. leakage validator | **READY** | `n2DatasetContract.test.ts` + 既存 `check:point-in-time-safety` |
| J. evaluation contract | **READY(設計)** | predictive/financial 分離・bootstrap・CLAUDE.md ROI 基準 |
| K. market baseline | **READY(設計)** | market-implied / frequency / 既存 policy / trivial |
| L. calibration | **READY(設計)** | 券種別 bucket + 信頼区間 |
| M. drift analysis | **READY** | 実測 drift 87%→99.9% + **2001–2003 coverage gap** |
| N. multiple-bet-type policy | **READY(設計)** | 券種別 model 基本 |

overall: **N2_IMPLEMENTATION_READY = YES**（契約・enforcement・prototype 完了）。**ただし model training は開始しない。**

## 実 feature 接続時の残タスク（N2 実装フェーズ・別承認）

1. feature dataset builder（boat.sqlite official_programs/odds を N1 label へ join、build path に `validateFeaturePIT`/`validateOddsUsage`/`stripLiveOnlyRacerFeatures` を必須化）。
2. 実 feature の available_at 付与（historical_safe=race日、odds=snapshot 時刻、集計=集計 cutoff）。
3. feature store 容量見積り。
4. 上記完了後に model training 承認を得る。

## 禁止（本フェーズ）

model training/tuning、BUY/WATCH/SKIP logic 変更、threshold tuning、production 接続、automatic betting、feature store 実装、N2 schema 追加。すべて別の明示承認まで着手しない。
