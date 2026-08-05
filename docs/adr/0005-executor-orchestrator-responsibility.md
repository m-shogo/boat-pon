# ADR-0005: Executor SDK と Orchestrator の責任境界

- status: accepted
- date: 2026-08-05

## 決定
研究 task 実行の責任を **Executor SDK** と **外部 Orchestrator（runner: `scripts/run-intent-task.ts`）** に分離する。

### Executor SDK（`src/research/governance/executorSdk.ts`）が保証すること
- `prepare → validateInputs → executeReadOnly → validatePitEvidence →`
  `writeArtifacts → verifyArtifactsByReadback → recordEvidence → finalizeEvidence`
- read-only 実行、artifact の atomic write + readback 検証、PIT/leakage evidence、
  **write-scope（planned / written / evidence / finalize すべて）**、secret / production isolation。
- **queue-state を一切変更しない。** `SdkOutcome.stateTransitionOwner = "EXTERNAL_ORCHESTRATOR"` /
  `stateTransitionPerformedByExecutor = false` を必ず返す。
- dry-run は `DRY_RUN_OK` を返し、**PASS を返さない**（write も行わない）。

### 外部 Orchestrator（runner）が単独で担当すること
- queue-state の CAS（compare-and-swap）と `READY→CLAIMED→RUNNING→PASS/FAILED/BLOCKED` 遷移
- `current-run.json` 更新、`processed-intents` / `processed-requests` ledger の append
- dry-run intent の短絡（executor を呼ばず `DRY_RUN_OK` を返す。task status を変えない）

## 根拠
- 二重 state transition を禁止する（SDK と runner の両方が遷移すると整合が壊れる）。
- artifact/evidence が成功しても、orchestrator の CAS が失敗すれば task は PASS にならない
  （runner の `updateState` が失敗すれば FAILED に落ちる。fail-closed）。
- 旧 callback 名 `transitionState` は責務を誤解させるため `finalizeEvidence` に改名した。

## 強制
- 型: `SdkOutcome` の `stateTransitionOwner` / `stateTransitionPerformedByExecutor`。
- テスト: SDK happy-path が external ownership を宣言すること、dry-run が DRY_RUN_OK であること、
  evidence/finalize の scope 違反が BLOCK されること、runner が executor の DRY_RUN_OK を PASS にしないこと。
- docs: 本 ADR と `docs/research-automation-operating-model.md`。
