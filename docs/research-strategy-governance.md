# 研究戦略ガバナンス（正本）

更新: 2026-08-05 / authority: ADR-0001..0004 の下位、master-plan の参照下。

## 中核原則
**発見は共有する。採用は競争させる。思想は保護する。**
探索は自由に、検証は厳格に。ROI だけで昇格しない。Discovery を自動採用しない。方式数を事前に固定しない。

## ライフサイクル
中立 `EXP-*`（Experiment）→ メカニズムが見えたら暫定 Strategy 名 → 同思想の改善は同名 version 更新 →
中心メカニズムが変われば **別 Strategy Family** → Discovery は Transfer Experiment 経由でのみ他方式へ →
Promotion は人間承認必須（production 非接続）。全 trial / 失敗 / 棄却 / negative result を保存する。

## Registry（individual-file / append-only, `research/registries/`）
Experiment / Discovery / Strategy Family / Strategy Version / Transfer Experiment / Promotion / Rejection。
（Runtime Decision Ledger / Outcome Learning Ledger / Forward Evaluation Vault は設計済み・実装は依存順に追加）。
型・validator: `src/research/governance/contracts.ts`。schema: `config/research-governance/`。

## 不変条件（CI 強制: `research:governance-check`）
- Discovery 自動採用不可（Transfer accepted のみ）。
- clean-room family は GLOBAL_FACT / RESEARCH_METHOD 以外を採用しない。
- Promotion の active_research/challenger は人間承認 + Transfer 証拠必須。`productionConnection` 常に false。
- Current BUY(`legacy_t5_formal`) と Research(`market_intelligence`) を混ぜない。
- holdout / validation / shadow_forward / future_only / historical を混ぜない（`evidenceStage`）。

## 評価の分離（混ぜない）
予想確率精度 / 市場 Edge / 券種・SKIP / ROI / 利益額 / calibration / CLV / drawdown / losing streak /
max-hit 依存 / 年代・会場・券種安定性 / 他方式との重複・損益相関 / future-only 再現性 —— を **別々に**評価する。
selected-race ROI と common-cohort comparison を混ぜない。BUY 時点 odds と closing odds を混ぜない。
