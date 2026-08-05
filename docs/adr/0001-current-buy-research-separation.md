# ADR-0001: Current BUY と Research の分離

- status: accepted
- date: 2026-08-05

## 決定
Current BUY（`decision_system = legacy_t5_formal` / `strategy_version = legacy-t5-v1`）と、新研究
（`market_intelligence`）を **構造的に分離**する。両者を同一評価系列・同一 registry entry・同一 ROI に混ぜない。

- Current BUY は研究基準の **固定 benchmark** として存続。挙動・条件・app_settings・production を研究中に変更しない。
- Current BUY は Strategy Registry に **observation_only** の version として登録し、観測・記録・reconciliation のみ追加する。
- 新研究は N7/N8 を通過し、独立した人間承認の production gate を経るまで **shadow のみ**。

## 強制
- `decisionSystem` フィールドで区別。CI（`research:governance-check`）が legacy family に非 observation version が
  混ざっていないか検査する。
- legacy formal ROI と new shadow ROI を混ぜない（別 metric・別 report）。

## 影響
`src/domain/decision.ts` 等の Current BUY コードは本研究で変更しない。研究は read-only 観測に限定。
