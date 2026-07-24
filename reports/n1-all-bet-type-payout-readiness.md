# Phase N1 全券種払戻基盤 Readiness

- 判定: **CONDITIONAL**
- review: **COMPLETE**
- schema/migration: **DESIGN ONLY / NOT_APPLIED**
- parser: **NOT_IMPLEMENTED**
- external request: **0**
- collector connection: **NONE**
- preferred storage: **Research Replay sidecar**

## 実測要約

既存 `race_payouts` は5,871,974 rows、1,190,226 races、5券種を保存する。win/place、raw hash、parser version、source revision、同着理由、返還line、訂正・conflict lifecycleがない。複数line raceと`wide=0-0`が実在するため、単一row／通常selectionへの強制変換は不適格である。

## Gate

| 項目 | 状態 |
|---|---|
| 保存先比較 | PASS |
| lineage / state machine / canonicalization | PASS |
| design DDL | PASS / NOT_APPLIED |
| 20-case fixture仕様 | PASS / fixture未実装 |
| parser・migration fixture test | PENDING |
| N1実装承認 | PENDING |

詳細正本: [`../docs/n1-all-bet-type-payout-review.md`](../docs/n1-all-bet-type-payout-review.md)
