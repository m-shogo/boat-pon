# N2 Readiness Audit（設計フェーズ・model training 未着手）

更新: 2026-07-30
scope: read-only。契約設計・enforcement・prototype・既存研究の PIT 再評価。model 実装/training なし。

## overall

**N2_IMPLEMENTATION_READY = YES**（契約・enforcement・prototype 完了）。N2 model training は本フェーズで開始しない。
別途の formal item: N1-C acceptance は依然 **CONDITIONAL / CI_INFRA_BLOCKED**（remote CI runner allocation のみ、N2 とは独立）。

## 成果物

- 契約: `docs/n2-data-contracts.md`（dataset/target/settlement-label/odds-timing）、`docs/n2-feature-pit-contract.md`、`docs/n2-evaluation-and-split.md`、`docs/n2-readiness-gate-checklist.md`（A–N gate）。
- enforcement（純関数＋tests）: `src/research-replay/n2DatasetContract.ts` / `n2DatasetContract.test.ts`（eligibility fail-closed・target・PIT 境界・odds timing・adversarial）。
- prototype/profile: `scripts/prototype-n2-dataset.ts` → `reports/n2/n2-dataset-profile.json`（eligible 96.03%、決定的再生成一致、pit proof）。

## 主要データ所見

- eligible **7,833,298 / 8,156,795（96.03%）**。除外: refunded 319,301、source_duplicate 4,196。
- 券種別 eligible: win 99.95% / place 97.45% / 多艇券種 ~95%（refund 率差）。hit 率・payout variance も券種差大 → **券種別 model/calibration 必須**。
- **temporal coverage gap（重要）**: local archive に **2001–2003 が欠落**、2000 は部分（131 files/57,122 candidate）。usable historical range は実質 **2004–2026**。→ N2 split は 2004 以降を連続基準にする。source 完全性の追補は別タスク（`docs/missing-dates.md`）。
- **eligibility/era drift**: 2004–2006 ≈87% → 2020+ ≈99.9%。早期の返還/除外率が高い（制度/フォーマット/集計差の可能性、bug 断定せず）。N2 は era を跨ぐ walk-forward で評価する。

## PHASE 20 — 既存 ROI/研究の PIT 再評価（cross-check）

過去の良い結果をそのまま N2 truth にしない。既存 reports/docs を PIT・held-out・market timing・多重検定・forward 確認の観点で分類。

| 研究 | 分類 | 理由 |
|---|---|---|
| courseStFactor / courseTop3Factor / exhibitionResidual 由来の historical backtest | **LEAKY / INVALID** | racer_course_stats は現在値1世代スナップショット。`enrichFeatures` の日付なし JOIN で過去 race に現在値注入（decision_history 1,969行中1,938行非中立の実証）。N2 historical では `validateFeaturePIT` が `excluded_live_only_in_historical` で拒否 |
| current_odds ベース ROI（gap 大） | **CONDITIONAL** | current_odds は締切前暫定・約14.94pt 楽観バイアス。gap≥10pt では信頼しない。N2 は実払戻 `payout_yen` を主 label/財務基準に、closing は評価専用 |
| condB 3連単 1-3-2 switch（paper-forward 格上げ待ち） | **CONDITIONAL** | forward n<200・top2除外 ROI 91%（目標100%未達）。forward 急伸は高配当依存チェック要。N2 では canonical settlement + 券種別 calibration + block bootstrap で再評価 |
| exacta market-residual sweep / forward monitor | **CONDITIONAL** | forward 確認途上。selection bias・多重検定リスク。canonical label + held-out で再検証 |
| calibration-stability / canonical-calibration | **SUPPORTED（方法論）** | calibration 評価枠組みは N2 の calibration contract に接続可（label は canonical settlement へ差し替え） |
| point-in-time-leak-impact（leak 実証） | **SUPPORTED（finding）** | leak の存在証拠そのもの。N2 の PIT contract の根拠として採用 |
| historical-closing-odds availability/quality | **CONDITIONAL（評価専用）** | closing odds は price evaluation 専用（feature 禁止）。availability に欠損あり |
| 会場/raceNo 除外系 ROI（skip filters） | **CONDITIONAL** | 多重検定・selection bias リスク大。canonical label + walk-forward + baseline 比較で再評価 |

原則: N2 は上記 SUPPORTED の方法論のみ再利用し、CONDITIONAL は canonical label で再検証、LEAKY は使用しない。

## 安全

model training なし。production/collector/GC/automatic betting 未接続。DB write は N1-C source-duplicate resolution（前フェーズ）以外なし（本フェーズは read-only + docs/tests/analyzer 追加のみ）。data/boat.sqlite は read-only 参照のみ。

## 次段階（別承認）

feature dataset builder 実装（PIT/odds/live-only guard を build path に必須化）→ feature store 容量見積り → その後 model training 承認。**本フェーズはここで停止**。
