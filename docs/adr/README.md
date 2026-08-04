# Architecture Decision Records (research platform)

権威順（authority order）— 文書が競合したら上位を優先する:

1. 絶対安全条件（production 非接続 / BUY・app_settings 不変 / 自動購入なし / 無承認 write なし） … 最優先・不可侵
2. 本 ADR 群（0001-0004）
3. `docs/research-platform-master-plan.md`（Phase・評価契約の正本）
4. `docs/research-strategy-governance.md` / `docs/edge-discovery-system.md` / `docs/research-storage-architecture.md` / `docs/research-automation-operating-model.md`
5. `config/research-governance/*.schema.json` と `src/research/governance/*`（実装契約）
6. `docs/boat-pon-research-dispatch.md`（運用 runbook）

- [ADR-0001 Current BUY と Research の分離](0001-current-buy-research-separation.md)
- [ADR-0002 Shared Commons と Strategy Local](0002-shared-commons-vs-strategy-local.md)
- [ADR-0003 Clean-room Challenger](0003-clean-room-challenger.md)
- [ADR-0004 Local-first / Cloud-ready storage](0004-local-first-cloud-ready-storage.md)
