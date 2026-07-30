# N2 Evaluation, Split, Baseline & Calibration Contract

更新: 2026-07-30
状態: 設計（model training 未着手）

## Split policy（PHASE 10）

- **random row split 禁止**（時系列問題）。train / validation / test は **time-based**。
- **同一 race 内の全 selection 行は同一 split**（race-level group split）。leakage 防止のため day-level group も可。
- 推奨: **expanding-window walk-forward**（過去→未来、複数 fold）。final held-out（最新期間）は model selection に使わない（別途最終評価専用）。
- **coverage gap 尊重**: 2001–2003 欠落・2000 部分（[`n2-data-contracts.md`](n2-data-contracts.md) §5）。連続期間を要する split は **2004 以降**を基準にする。
- **era drift 尊重**: eligibility/refund 率が年で drift（87%→99.9%）。制度/選手入替/会場 drift もあるため、古い期間で学習し最新で評価する fold を必ず含める。

## Evaluation contract（PHASE 14）— predictive と financial を分離

| 分類 | metric |
|---|---|
| predictive | log loss / Brier score / calibration error (ECE) / ranking (AUC・top-k hit) / hit rate |
| financial | ROI / yield / total stake / total payout / max drawdown / longest losing streak / bet count / coverage |

- **model 選択を ROI だけで行わない**（variance 大）。predictive quality を主、financial を従で見る。
- ROI は sample size / 信頼区間 / block bootstrap（race 単位ブロック）/ 期間別安定性を必須報告。CLAUDE.md の ROI 評価基準（実払戻 `payout_yen` 主、`current_odds` は gap≥10pt で不信頼、約14.94pt 楽観バイアス）に整合させる。

## Market baselines（PHASE 15）

N2 は最低限以下を上回らなければ意味がない:
1. market-implied probability（1/odds を正規化した implied、closing は評価専用）
2. simple historical frequency（course/venue 別頻度）
3. 既存 model / 既存 production・paper policy（decision_history）
4. trivial baseline（1号艇1着など）

baseline を下回る複雑 model は不採用。baseline は同一 split・同一 evaluation contract で比較。

## Calibration contract（PHASE 16）

- predicted probability bucket（0–10%,…,90–100%）ごとに empirical hit rate を評価（「70%と言ったら約70%当たる」）。
- **券種別**に calibration を分ける（hit 率分布が大きく異なる）。small-sample bucket は信頼区間付き。
- 既存 `calibration-stability` / `canonical-calibration` report の枠組みを N2 canonical settlement label 基準へ接続する。

## Multiple bet types（PHASE 17）

- 現時点の設計判断: **券種別 model を基本**とする。理由:
  - target semantics（艇番 vs 2艇 vs 3艇・順序）と hit 率・payout variance・class balance が券種で大きく異なる（win 99.95% eligible・高 hit 率 ↔ trifecta 94.9% eligible・低 hit 率・高 payout variance）。
  - calibration/評価も券種別が必要。
- 共有可能な feature backbone（選手/motor/venue）を持ちつつ head を券種別にする案は N2 実装時に比較（本 design record に記録、training はしない）。

## 禁止（本フェーズ）

model training/tuning、threshold tuning、BUY/WATCH/SKIP 変更、production 接続、automatic betting。すべて別承認まで着手しない。
