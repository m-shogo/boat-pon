# ChatGPT Scheduled Task bridge（boat-pon / intent 方式）

更新: 2026-08-04

ChatGPT の Scheduled Task が **1 時間ごとに 1 回だけ** GitHub 経由で boat-pon の次の 1 task を依頼するための橋渡し。
**このリポジトリ側には schedule / cron / launchd hourly / daemon loop を一切作らない**（禁止）。毎時トリガーは ChatGPT 側のみ。

## 最重要変更（2026-08-04）

- **ChatGPT に SHA-256 / hash / canonical JSON digest を計算させない。**
- ChatGPT は **最小 intent**（`automation/requests/intents/INTENT-*.json`）を **1 件 commit** するだけ。
- `queueDigest` / `requestDigest` / canonical request の生成は **GitHub 側の ubuntu guard** が行う。
- 可変状態（queue state / ledger）の正本は **`automation/boat-pon-research` branch の `automation/control/`** に一本化。
  main の `automation/task-catalog.json` は **定義（immutable）**、`automation/task-queue.json` は **凍結（非 authority）**。

## 役割分担

| plane | 担当 | 役割 |
|---|---|---|
| control / review / planning | ChatGPT Scheduled Task | 状態を読み、次の 1 task を選び、最小 intent を 1 件 commit |
| authority（定義） | GitHub main | task catalog / schema / policy / workflow / immutable intent |
| authority（状態） | GitHub `automation/boat-pon-research` | queue state / processed ledger / reports / dashboard / planner |
| execution | Mac self-hosted runner | dispatch された 1 task だけ実行し結果を branch へ返す |

## Dispatch 経路（intent 方式）

```
ChatGPT ──(最小 intent を main へ 1 件 commit)──▶ GitHub main
   push(automation/requests/intents/*.json)
        │
        ▼
ubuntu guard（boat-pon-intent-dispatch.yml）
   actor policy / exactly-one-added / expectedAuthoritySha /
   catalog READY・deps PASS・not RUNNING / replay(ledger) 検証 →
   queueDigest・requestDigest を計算し canonical request を生成（artifact）
        │
        ▼
Mac self-hosted runner
   automation branch から control state を materialize →
   1 task 実行（read-only executor）→ state/ledger/report を branch へ commit → idle
```

- guard は ubuntu、runner は self-hosted。`on.schedule` は無い。1 dispatch = 1 task。自動再 dispatch なし。

## 最小 intent schema（ChatGPT が作るのはこれだけ）

`config/research-dispatch-intent.schema.json`。hash は含めない。

```json
{
  "intentSchemaVersion": "research-dispatch-intent-v1",
  "intentId": "INTENT-<YYYYMMDD>-<10英数>",
  "taskId": "TASK-N2-006",
  "requestedAction": "run-task",
  "safetyLevel": "L0",
  "expectedAuthoritySha": "<最新 main の short SHA>",
  "maxDurationSeconds": 1800,
  "requestedBy": "chatgpt-scheduled-task",
  "requestReference": "chatgpt-hourly:<一意の参照>"
}
```

- `requestedAction`: `run-task` / `dry-run` / `plan-next`
- `safetyLevel`: `L0`/`L1`/`L2`（`L3` は `approvalGrantId` 必須、`L4` は不可）
- filename は `INTENT-<intentId>.json`（intentId と完全一致）
- **1 push につき新規 intent 1 件のみ**。既存 file の変更・削除は不可（immutable）。

## Scheduled Task に貼り付ける最終 prompt（hash 不要）

```text
あなたは boat-pon 研究基盤の control plane です。実行環境は ChatGPT のみで、Mac へ直接アクセスできません。
Mac 上の処理は GitHub 上に最小 intent file を 1 件 commit することで依頼します。SHA-256 やハッシュは計算しません。
今回の実行では以下を順に行ってください。

1. GitHub m-shogo/boat-pon の main 最新 SHA（short）と最新 CI 結果を確認する。
2. automation/boat-pon-research branch の reports/automation/current-status.json と
   automation/control/task-queue-state.json を読み、前回 run の結果と各 task の status を把握する。
3. automation/control/processed-intents.json と processed-requests.json で処理済みを確認する。
4. main の automation/task-catalog.json を読み、task 定義（taskType/safety/dependencies）を把握する。
5. CLAIMED / RUNNING の task があれば新しい intent を作らない（二重実行防止）。
6. status=READY かつ dependencies がすべて PASS の task から、今回もっとも価値が高い 1 件を選ぶ。
   READY が 0 なら taskId=TASK-PLANNER-NEXT を選ぶ（次候補を補充させる）。それも不要なら何も commit しない。
7. safety を確認する。L0/L1/L2 のみ。L3 は既存の有効な approvalGrantId がある場合のみ。L4 は絶対に選ばない。
8. 最小 intent JSON を作る。フィールドは intentSchemaVersion=research-dispatch-intent-v1 /
   intentId=INTENT-<YYYYMMDD>-<10英数> / taskId / requestedAction=run-task /
   safetyLevel / expectedAuthoritySha=(手順1の main short SHA) / maxDurationSeconds /
   requestedBy="chatgpt-scheduled-task" / requestReference。ハッシュ・digest は入れない。
9. その JSON を main の automation/requests/intents/<intentId>.json へ 新規 file として 1 件だけ commit する。
   既存 file の変更・削除はしない。1 回の実行で 2 件以上 commit しない。
10. commit した時点では「完了」と報告しない。処理は次回の実行で確認する。
11. 前回 dispatch の結果（automation branch の current-status / task-queue-state / history）を確認し、
    PASS / CONDITIONAL / BLOCKED / DRY_RUN_OK / FAILED を判定する。
12. 意味のある進捗（新しい証拠・task 状態遷移・blocker の発生解消）があるときだけ通知する。変化が無ければ通知しない。

厳守事項:
- 1 回の実行につき最大 1 intent commit。自分で連続 commit しない。
- SHA-256 / canonical JSON hash / requestDigest / queueDigest を計算しない（GitHub 側が生成する）。
- automation branch の状態を直接書き換えない（読むだけ）。
- Mac へ直接アクセスしたと装わない。commit 直後に完了と報告しない。
- production approval を作らない。L4（BUY 条件 / 自動投票 / 自動購入 / 資金 / credential / production 接続）は依頼しない。
- 実測していない数値を報告しない。無い値は NOT_STARTED / NOT_AVAILABLE / BLOCKED / NOT_APPLICABLE と書く。
- 失敗を PASS として報告しない。
```

## 連携前に 1 回だけ必要：ChatGPT connector probe

ChatGPT の GitHub connector が commit する実 actor は GitHub App / integration の可能性があり、Claude Code からは確認できない。
毎時 schedule を登録する前に、**このチャットの connector から probe intent を 1 回だけ commit** して実 actor を確認する。

- probe path: `automation/requests/intents/INTENT-connector-probe-1.json`
- probe JSON（`expectedAuthoritySha` は commit 時点の main short SHA に更新する。actor 確認が主目的なので多少 stale でも actor evidence は記録される）:

```json
{
  "intentSchemaVersion": "research-dispatch-intent-v1",
  "intentId": "INTENT-connector-probe-1",
  "taskId": "TASK-PLANNER-NEXT",
  "requestedAction": "dry-run",
  "safetyLevel": "L0",
  "expectedAuthoritySha": "<最新 main short SHA>",
  "maxDurationSeconds": 1800,
  "requestedBy": "chatgpt-scheduled-task",
  "requestReference": "connector-probe-1"
}
```

- 期待挙動:
  - actor が未許可（既定）→ guard が **safe BLOCK**。runner は起動しない。sidecar write 0・研究 0。
  - guard の **Step Summary / job output** に `observedActor / observedAuthor / observedCommitter` が記録される。
  - actor が既に許可済み（owner 手動など）→ dry-run で `DRY_RUN_OK`（研究せず終了）。
- 確認後の手順:
  1. probe run の Step Summary から `observedActor` を読む。
  2. `config/actor-allowlist-policy.json` の `allowedActors` にその actor を `verified: true` で明示追加（wildcard/org/fork は不可）。commit + push。
  3. 以後、その actor の intent commit が guard を通過する。
  4. `docs/chatgpt-scheduled-task-bridge.md` の最終 prompt を毎時 Scheduled Task に登録する。

## 結果確認の経路

- `automation/boat-pon-research` branch:
  `reports/automation/current-status.json`（最新 run の result・blocks・nextCandidate）
  `automation/control/task-queue-state.json`（task 状態の正本）
  `automation/control/processed-{intents,requests}.json`（replay ledger）
  `automation/control/planner-candidates.json`（次候補）
  `reports/automation/history/<runId>-<taskId>.json` / `reports/n2/n2-*.json`
- `reports/automation/research-dashboard.html`（control/runner/research/safety 4 plane）

## 境界

- **L0/L1/L2**: 自動実行可（read-only executor）。**L3**: 既存 grant 必須。**L4**: 常時拒否。
- executor 未実装の taskType は catalog で `BLOCKED_EXECUTOR_PENDING`。READY 化しない。EXECUTOR_NOT_REGISTERED は BLOCK。
- production 昇格・BUY 条件・app_settings・sidecar write・自動投票は対象外（禁止）。
