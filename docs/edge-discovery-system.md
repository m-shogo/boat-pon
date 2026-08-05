# Edge Discovery System（正本）

更新: 2026-08-05

条件の総当たりを Edge 発見と呼ばない。**仮説・メカニズム・必要データ・反証条件**を必須にする。

## 構成要素
1. Edge Taxonomy（探索レーン）  2. Hypothesis Factory  3. Novelty Gate  4. Duplicate detection
5. Negative Control  6. Placebo test  7. trial family  8. total trial count  9. Value of Information
10. Clean-room lane  11. Transfer Experiment  12. Diversity Report  13. SKIP/Abstention Edge research

## 探索レーン
Market Structure / Racer Structure / Race Interaction / Exhibition Reaction / Environment / Equipment /
Cross-Market Pricing / Ticket Selection / Portfolio / SKIP・Abstention / Clean-room Statistical /
Clean-room Market Microstructure。

## Novelty / 多重検定
新規仮説は Rejection Ledger と既存 Discovery/Experiment に対して重複を確認（Novelty Gate）。
`trialFamilyId` / `totalTrialCount` / `multiplicityFamily` を必須にし、family 単位で多重検定リスクを追跡する。

## Diversity Report（standalone と portfolio contribution を分離）
selected race overlap / ticket overlap / prediction correlation / expected value correlation /
daily profit correlation / miss correlation / drawdown correlation / venue concentration /
bet type concentration / feature family overlap / high-payout dependency。

## Transfer Experiment（採用の唯一経路）
sourceDiscovery / target / base+candidate version / historical / validation / untouched holdout /
shadow forward / calibration / ROI 下限 / max-hit removal / drawdown / coverage / diversity impact を評価。
中心思想が変わる場合は同名 version ではなく別 Strategy Family へ分離する。
