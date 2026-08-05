# 研究自動化オペレーティングモデル（3 レーン）

更新: 2026-08-05 / authority: ADR 群の下位、`docs/boat-pon-research-dispatch.md` の上位。

ChatGPT Scheduled Task は 3 つのレーンで boat-pon 研究を進める。いずれも
**1 実行 = 最大 1 intent commit**、schedule/cron/daemon は repo 側に作らない、production/BUY/app_settings 非接続。

## Hourly Execution Lane（実行）
実装済み executor の 1 task を実行する。
- 前回結果（automation branch の current-status / task-queue-state）を確認する。
- CLAIMED / RUNNING 中は新規 dispatch しない。
- READY かつ dependencies が PASS の task を 1 件だけ選ぶ。L0/L1/L2 のみ。
- executor 未実装の taskType は **ENGINEERING_REQUIRED**（SDK が停止させる。planner を無限反復させない）。
- intent 直後に完了扱いしない。結果は次回確認する。production / BUY を変更しない。
- READY が無ければ `TASK-PLANNER-NEXT`（planner）で次候補を提案させる。

## Daily Discovery Lane（探索）
Edge Taxonomy の未探索領域から新しい Experiment を提案する（自動採用・自動昇格はしない）。
- taxonomy の未探索レーンを確認する。
- 既存 Experiment / Discovery / Rejection Ledger と重複を確認する（Novelty Gate）。
- 最大 1〜3 件の `EXP-*` を提案する。mechanism hypothesis と反証条件を記録し、protocol を事前固定する。
- Discovery の自動採用・Strategy への直接追加はしない（Transfer Experiment 経由のみ）。

## Weekly Governance Lane（統治）
研究全体の健全性を点検する。
- trial count / 多重検定リスク / holdout 汚染 / max-hit 依存 / overlap・correlation。
- clean-room 違反 / Edge decay / Current BUY 混入 / storage 容量 / runner 信頼性。
- Cloudflare 導入条件（ADR-0004）/ **ENGINEERING_REQUIRED 一覧**（未実装 executor の依存順）。
- 出力は report / registry 追記のみ。production 昇格・BUY 変更はしない。

## 安全境界（全レーン共通）
- 1 実行 1 intent。自動連続 dispatch なし。schedule/cron/daemon/無限 loop を repo に作らない。
- L4（BUY 条件 / 自動投票 / 自動購入 / 資金 / credential / production 接続）は依頼も実行もしない。
- research result を production approval として扱わない。人間承認なしに ACTIVE/production へ昇格しない。
- 実測していない数値を報告しない。無い値は NOT_STARTED / NOT_AVAILABLE / BLOCKED / ENGINEERING_REQUIRED。

## ENGINEERING_REQUIRED の扱い
未実装 executor（`pit-audit` / `baseline-*` / `evaluation-metrics` / `edge-*` / `confounder-audit`）は
catalog で `BLOCKED_EXECUTOR_PENDING`。誤って dispatch されても SDK が `ENGINEERING_REQUIRED` を返して停止する。
実装は `docs/research-platform-master-plan.md` の Phase 依存順（N2→N3→N4→N5→N6→N7→N8, D2/E1/E2）に従う。

## Executor SDK と Orchestrator の責任境界（ADR-0005）

- **Executor SDK**: artifact + evidence の完成までを保証（read-only / write-scope / PIT / readback）。
  **queue-state を変更しない**。dry-run は `DRY_RUN_OK`（PASS ではない・write なし）。
- **Orchestrator（runner）**: queue-state CAS・`READY→…→PASS/FAILED/BLOCKED` 遷移・current-run・
  processed ledger を **単独で** 担当。dry-run intent は executor を呼ばず短絡し task status を変えない。
- artifact/evidence が成功しても orchestrator の CAS が失敗すれば task は PASS にならない（fail-closed）。
- state transition は 1 回だけ。replay/idempotency で二重遷移しない。
