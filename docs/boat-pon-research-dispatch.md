# boat-pon research dispatch runbook（intent 方式）

更新: 2026-08-04

## 経路

| 経路 | trigger | 状態 |
|---|---|---|
| **intent dispatch**（正式） | `push` main `automation/requests/intents/*.json` | 実装・E2E 実証済み |
| request-file dispatch | — | **DEPRECATED**（stub 化。push trigger 廃止） |

**`on.schedule` / cron / launchd hourly / daemon は無い（禁止）。** 1 dispatch = 1 task。workflow は自分を再 dispatch しない。

## 正本の分離（二重 queue なし）

| 置き場所 | 内容 |
|---|---|
| **main（immutable 定義）** | `automation/task-catalog.json`（task 定義）、schema、policy、workflow、code、immutable intent |
| **`automation/boat-pon-research`（可変状態の正本）** | `automation/control/task-queue-state.json`（status）、`processed-intents.json` / `processed-requests.json`（ledger）、`current-run.json`、`planner-candidates.json`、reports、dashboard |

- main の `automation/task-queue.json` は **凍結（`_deprecated`）**。dispatch 判断に使わない。
- ChatGPT は main catalog + branch state を読んで判断し、状態は runner だけが branch へ書く。

## 1 回の流れ

1. ChatGPT が `automation/requests/intents/INTENT-<id>.json` を main へ 1 件 commit（hash 不要）。
2. `boat-pon-intent-dispatch.yml` 起動（guard job → runner job、`concurrency: boat-pon-local-research`, `cancel-in-progress:false`）。
3. **ubuntu guard**（`scripts/guard-intent-push.ts`）:
   - actor policy（verified allowlist、wildcard/org/fork/PR 禁止）+ actor evidence 記録
   - exactly-one-added / immutable / path / filename↔intentId / strict schema / size / symlink
   - `expectedAuthoritySha` を最新 main（after/parent）に前方一致
   - catalog + branch-state を merge → task 存在・READY・deps PASS・not RUNNING
   - replay: `processed-intents` / `processed-requests` に intentId/requestId が無い
   - safety（L4 拒否、L3 grant 必須）
   - `queueDigest = computeStateDigest(state)`・`requestDigest` を計算し **canonical request** を artifact 出力
4. **self-hosted runner**（`scripts/run-intent-task.ts`）:
   - automation branch から control state を materialize（base SHA を記録）
   - canonical request を再検証 → preflight（emergency/pause/dirty/drift/WAL/disk/queueDigest CAS/replay）
   - idempotency key（task+defVer+authority+stateVer+executorVer+inputIdentity+safety）。同 key の成功があれば再実行せず既存 evidence を返す
   - executor registry 解決（未登録は `EXECUTOR_NOT_REGISTERED` で BLOCK）
   - state を `READY→CLAIMED→RUNNING→PASS/…` と atomic 遷移（`canTransition` 検証、stateVersion++）
   - recurring task（planner）は成功後 READY へ戻す
   - evidence / report / ledger を書き、`automation-commit.sh` が **CAS（base SHA 不変）** を確認して branch へ commit
   - runner は idle。次 task を自動起動しない

## Executor registry（allowlist）

| taskType | 状態 | safety | 出力 |
|---|---|---|---|
| `dataset-canary` | 実装済 | L2 | reports/n2/n2-dataset-canary.json |
| `readonly-analysis` | 実装済 | L0 | reports/n2/n2-corrected-eligibility.json |
| `readonly-audit` | 実装済 | L0 | reports/n2/n2-win-refund-omission-audit.json |
| `dataset-inventory` | 実装済 | L0 | reports/n2/n2-dataset-inventory.json |
| `holdout-freeze` | 実装済 | L0 | reports/n2/n2-holdout-freeze.json |
| `feature-coverage-audit` | 実装済 | L0 | reports/n2/n2-feature-coverage-audit.json |
| `planner-next` | 実装済（recurring） | L0 | automation/control/planner-candidates.json |
| `dataset-expand` / `pit-audit` / `baseline-*` / `evaluation-metrics` / `edge-*` / `confounder-audit` | **未実装** | L0 | catalog で `BLOCKED_EXECUTOR_PENDING`（READY 化しない） |

- 全 executor は **read-only**（実 sidecar へ write しない）。実データは `policy.dataRoot`（canonical repo path）から immutable open。
- arbitrary shell 禁止。free-form prompt を command 化しない。未実装 taskType が READY に混ざらないよう catalog 生成時に検査する。

## Replay / idempotency

- **intent replay**: `processed-intents.json` の intentId 再利用を guard が拒否。
- **request replay**: `processed-requests.json` の requestId 再利用を guard/runner が拒否。
- **構造防御**: intent は added-only + immutable + 1-push-1-file。処理済み intentId の再投入は modified/no-op となり guard が拒否。
- **idempotency key**: 同 key の成功があれば再実行せず既存 evidence を返す（workflow rerun / failed job rerun の二重実行防止）。
- **CAS**: materialize 時の branch base SHA から進んでいたら commit を fail-closed（concurrent 変更を clobber しない）。

## Queue planner（枯渇対策・自動実行なし）

- `TASK-PLANNER-NEXT`（recurring, L0）: READY が枯れたとき ChatGPT が選ぶ。`planner-next` executor が
  `BLOCKED_EXECUTOR_PENDING` 群を次候補として `automation/control/planner-candidates.json` に提案する。
- planner は **提案のみ**。自動 dispatch・自動実行・無限生成はしない。READY がある間は補充不要。

## 手動 command

```bash
node --import tsx scripts/build-intent-cli.ts --task-id=TASK-N2-006 --requested-action=run-task --safety-level=L0 --write
pnpm automation:guard-intent        # guard（通常は workflow が実行）
pnpm automation:intent-task -- --request=canonical-request.json --intent-id=<id>
pnpm report:automation:dashboard
pnpm automation:pause / resume / emergency-stop / clear-emergency-stop
```

## 関連ドキュメント

- `docs/chatgpt-scheduled-task-bridge.md` — Scheduled Task 用 prompt + connector probe
- `docs/current-ai-handoff.md` — 実装履歴と現状
- `config/research-dispatch-intent.schema.json` / `research-task-catalog.schema.json` / `research-task-request.schema.json`
- `config/actor-allowlist-policy.json` — actor 許可（wildcard/org/fork 禁止）
