# N2 Readiness Gate Checklist（着手前・設計のみ）

更新: 2026-08-01
状態: **N2 contract hardening中（label truth未確定、model/training未着手）**

N1-C（全券種 settlement canonical 基盤）完成を受け、N2（市場残差/選手能力等を用いた予測・評価フェーズ）へ進む前に満たすべき gate を、repo・docs・schema・reports から整理する。本書は checklist であり、N2 実装・training・BUY/WATCH/SKIP・threshold 変更・production 接続は一切行わない。

## N1 が N2 へ提供するもの（READY）

| 項目 | 状態 | 根拠 |
|---|---|---|
| settlement truth（全7券種、payout/refund/status） | STRUCTURE READY / SEMANTICS AUDIT PENDING | integrity/FKは通過。parser v1特払い誤分類のraw全件再集計は未完了 |
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
| A. canonical settlement truth | **CONDITIONAL** | structural integrity/active uniquenessはPASS。`ARCHIVE_REFUND_SEMANTICS_AUDIT`のraw再集計・supersession未完了 |
| B. training dataset contract | **READY(scaffold+adapter contract) / PROFILE STALE** | selection builder + legacy source adapter純関数を実装。unsafe/lineage不足はcandidate全体0行。primary DBの実lineage join未接続。96.03%はparser v1由来を含み再集計までtruthにしない |
| C. target definition | **READY(enforcement)** | target v2、7券種212 selection列挙、`hit/loss/refund/special_payout/void`、12 contract tests PASS |
| D. feature PIT | **READY(enforcement+adapter contract) / BLOCKED(real lineage)** | namespaced class laundering拒否。`imported_at`/race dateをavailabilityへ代用しないadapter実装。primary DBにsource availability/raw lineageなし |
| E. odds PIT/timing | **READY(enforcement+adapter contract) / BLOCKED(real lineage)** | captured_atは保守的availabilityに変換可だがraw lineage必須。bet_type不明legacy rowは推測せず拒否。実lineage join未接続 |
| F. unresolved settlement handling | **CONDITIONAL** | conflict/cancel/source_duplicateはfail-closed。部分返還labelは修正済みだがarchive明示返還のraw監査が未完了 |
| G. dataset reproducibility | **READY(code) / PENDING(real data run)** | immutable DBをclose後、別connectionで入力を再読込する独立rebuild script実装。隔離SQLite fixtureでPASS、実sidecar実行は未確認 |
| H. split policy | **READY(設計)** | time-based・race-level group・coverage gap/era drift 尊重 |
| I. leakage validator | **READY** | `n2DatasetContract.test.ts` + 既存 `check:point-in-time-safety` |
| J. evaluation contract | **READY(設計)** | predictive/financial 分離・bootstrap・CLAUDE.md ROI 基準 |
| K. market baseline | **READY(設計)** | market-implied / frequency / 既存 policy / trivial |
| L. calibration | **READY(設計)** | 券種別 bucket + 信頼区間 |
| M. drift analysis | **CONDITIONAL** | 2001–2003 gapは確定。87%→99.9%はparser v1影響を再集計するまで未確認 |
| N. multiple-bet-type policy | **READY(設計)** | 券種別 model 基本 |

overall: **N2_FEATURE_BUILDER_SCAFFOLD_READY = YES / N2_LABEL_TRUTH_READY = NO**。旧 `N2_IMPLEMENTATION_READY=YES` は実装着手準備だけを意味し、dataset完成・学習開始可を意味しない。

## 実 feature 接続までの残タスク

1. primary DB rowをF0 immutable observation/raw evidenceへread-only joinし、実装済みsource adapterへlineageを供給するreader。
2. 実 feature の available_at 付与（historical_safe=source availability必須、race日/imported_at代用禁止、odds=capture時刻を保守的境界、集計=集計 cutoff）。
3. feature store 容量見積り。
4. 実sidecarでselection profile独立rebuildを実行し、archive/canonical label truth訂正後に再生成する。
5. 上記を通過後、offline training gateへ進む。

## 禁止（本フェーズ）

label truth gate通過前のmodel training/tuning、BUY/WATCH/SKIP logic変更、production接続、automatic bettingは禁止。offline code/test/read-only dataset・評価基盤は安全境界内で段階実装する。
