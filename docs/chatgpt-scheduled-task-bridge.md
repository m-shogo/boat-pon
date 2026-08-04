# ChatGPT Scheduled Task bridge（boat-pon）

更新: 2026-08-04

ChatGPT の Scheduled Task が **1 時間ごとに 1 回だけ** GitHub 経由で boat-pon の次の 1 task を依頼するための橋渡し文書。
**このリポジトリ側には schedule / cron / launchd hourly / daemon loop を一切作らない**（禁止）。
毎時のトリガーは ChatGPT 側の Scheduled Task だけが持つ。

## 役割分担

| plane | 担当 | 役割 |
|---|---|---|
| control / review / planning | ChatGPT Scheduled Task | 最新状態を読み、次の 1 task を選び、GitHub へ 1 回だけ依頼する |
| authority / queue / evidence | GitHub (`m-shogo/boat-pon`) | main / task queue / registries / status / reports / workflow |
| execution | Mac self-hosted runner | dispatch された 1 job だけを実行し、結果を automation branch へ返す |

runner は **job 待機のみ**。自発的に研究処理を定期実行しない。

## Dispatch 経路（第一経路 = request file commit）

ChatGPT の GitHub connector は **workflow_dispatch を起動できない**が、**file create はできる**。
そのため正式経路は「request JSON を main へ commit する」方式とする。

| 優先 | 経路 | 状態 |
|---|---|---|
| **1（推奨）** | **request file commit**（`automation/requests/pending/REQ-*.json`） | **実装済み・E2E 実証済み** |
| 2 | control issue の allowlist command | 未実装（必要になれば追加） |
| 3 | workflow_dispatch | 実装済みだが ChatGPT connector からは起動不可 |
| 4 | 人間向け exact command 提示 | fallback |

commit すると `.github/workflows/boat-pon-request-file-dispatch.yml`（`push` / `main` / `automation/requests/pending/*.json`）が
1 回だけ起動し、self-hosted runner が 1 task を実行して結果を `automation/boat-pon-research` branch へ返す。

### ChatGPT connector 確認チェックリスト

- [x] `m-shogo/boat-pon` の main の file を読める（status / queue / reports）
- [x] main へ新規 file を作成できる（= request file commit ができる）→ **第一経路として使う**
- [ ] workflow_dispatch を起動できる（できない前提。できる環境なら経路 3 も可）
- [ ] issue comment を作成できる（経路 2 を実装する場合のみ必要）

## request JSON の作り方

`automation/request-template.json` を雛形にする。**計算が必要な値**:

- `queueDigest`: `automation/task-queue.json` を JSON.parse → `JSON.stringify()` した文字列の SHA-256
- `requestDigest`: `requestDigest` 自身を除いた request を **key 昇順**で `JSON.stringify` した文字列の SHA-256
- `authoritySha`: 参照した main の short SHA（request commit で main が 1 つ進むのは許容される）
- `requestId`: `REQ-<YYYYMMDD>-<10hex>`。**filename は `REQ-<...>.json` と完全一致させる**

ローカル/operator は次でも生成できる:

```bash
pnpm automation:build-request -- --task-id=TASK-N2-001 --requested-action=run-task \
  --safety-level=L2 --max-duration-seconds=3600 --request-reference="chatgpt:<run id>" --write
```

## Scheduled Task に貼り付ける最終 prompt

> 以下をそのまま ChatGPT の Scheduled Task（毎時）へ登録する。

```text
あなたは boat-pon 研究基盤の control plane です。実行環境は ChatGPT のみで、Mac へ直接アクセスできません。
Mac 上の処理は必ず GitHub 上の request file commit として 1 回だけ依頼します。今回の実行では以下を順に行ってください。

1. GitHub `m-shogo/boat-pon` の main 最新 SHA と最新 CI 結果を確認する。
2. `automation/boat-pon-research` branch の `reports/automation/current-status.json` を読み、前回 run の
   result / blocks / nextCandidate を把握する（無ければ main 側を読む）。
3. main の `automation/task-queue.json` を読み、各 task の status・dependencies・attemptCount を確認する。
4. `automation/requests/completed/` と `automation/requests/failed/` の直近 outcome を確認する。
5. 同じ task が同じ理由で連続失敗していないか確認する。連続失敗していれば dispatch せず原因分析だけ報告する。
6. status が CLAIMED / RUNNING の task があれば、新しい request を作らない（二重実行防止）。
7. status=READY かつ dependencies がすべて PASS の task から、今回もっとも価値が高い 1 件を選ぶ。
   選べない場合は何も dispatch しない。
8. safety level を確認する。L0/L1/L2 のみ dispatch してよい。L3 は既存の有効な approval grant がある場合のみ、
   無ければ人間の承認を求める。L4 は絶対に依頼しない。
9. request JSON を作る。requestSchemaVersion=research-task-request-v1、requestId=REQ-<YYYYMMDD>-<10hex>、
   taskId / requestedAction=run-task / safetyLevel / authoritySha(=確認した main SHA) /
   queueDigest(=task-queue.json の SHA-256) / createdAt / requestedBy="chatgpt-scheduled-task" /
   maxDurationSeconds / expectedOutput="reports/automation/current-status.json" /
   approvalRequirement="none"（L3 のみ "existing-grant-required"）/ requestDigest。
   requestDigest は requestDigest を除いた request を key 昇順 JSON.stringify した文字列の SHA-256。
10. その JSON を main の `automation/requests/pending/<requestId>.json` へ **新規 file として 1 件だけ** commit する。
    既存 file の変更・削除はしない。1 回の実行で 2 件以上 commit しない。
11. commit した時点では「完了」と報告しない。処理は次回の実行で確認する。
12. 前回 dispatch の結果（automation branch の current-status / history / task-queue）を確認し、
    PASS / CONDITIONAL / BLOCKED / NO_CHANGE / FAILED を判定する。
13. 意味のある進捗（新しい証拠、task 状態遷移、blocker の発生・解消）があるときだけ通知する。
    NO_CHANGE のみのときは通知しない。

厳守事項:
- 1 回の実行につき最大 1 dispatch。自分で連続 dispatch しない。
- Mac へ直接アクセスしたと装わない。dispatch 直後に完了と報告しない。
- production approval を作成しない。
- L4（BUY 条件変更 / prediction production 接続 / 自動投票 / 自動購入 / 資金利用 / credential 変更）は依頼も実行もしない。
- 実測していない数値を報告しない。値が無い場合は NOT_STARTED / NOT_AVAILABLE / BLOCKED / NOT_APPLICABLE と書く。
- 失敗を PASS として報告しない。
```

## 結果確認の経路

- `automation/boat-pon-research` branch の
  `reports/automation/current-status.json` / `.md`（最新 run の result・blocks・nextCandidate）
  `reports/automation/history/<runId>-<taskId>.json`（run ごとの証拠）
  `automation/task-queue.json`（task 状態遷移）
  `reports/n2/n2-*.json`（研究成果物）
- `reports/automation/research-dashboard.html`（人間向け可視化）
- GitHub Actions の `boat-pon request-file dispatch (one-shot)` run 結果

## 境界

- **L0/L1/L2**: 自動実行可（read-only 集計 / scripts / temp-copy・canary）。
- **L3**: 実 sidecar への append-only write 等。事前の有効な approval grant が必須。無ければ orchestrator が exit 3 で BLOCK。
- **L4**: 常時拒否。guard と orchestrator の両方で reject する。
- **NO_CHANGE**: 変更が無ければ commit も通知もしない。

## guard（request file push 時）

repo / actor(`m-shogo`) / branch(`main`) / event(`push`)、**新規 request は 1 push につき 1 件のみ**、
modified/deleted の request は拒否、path traversal・symlink・非 `.json`・サイズ上限、strict schema、
filename↔requestId 一致、`requestDigest` / `queueDigest` / `authoritySha` 検証、
completed/failed registry による replay 拒否、CLAIMED/RUNNING の重複依頼拒否、L4 常時拒否・L3 は grant 必須。
