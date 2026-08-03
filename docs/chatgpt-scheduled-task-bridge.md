# ChatGPT Scheduled Task bridge（boat-pon）

更新: 2026-08-03

ChatGPT の Scheduled Task が **1 時間ごとに 1 回だけ** GitHub 経由で boat-pon の次の 1 task を依頼するための橋渡し文書。
**このリポジトリ側には schedule / cron / launchd hourly / daemon loop を一切作らない**（禁止）。
毎時のトリガーは ChatGPT 側の Scheduled Task だけが持つ。

## 役割分担

| plane | 担当 | 役割 |
|---|---|---|
| control / review / planning | ChatGPT Scheduled Task | 最新状態を読み、次の 1 task を選び、GitHub へ 1 回だけ依頼する |
| authority / queue / evidence | GitHub (`m-shogo/boat-pon`) | main / task queue / registries / status / reports / workflow |
| execution | Mac self-hosted runner | dispatch された 1 job だけを実行し、結果を GitHub へ返す |

runner は **job 待機のみ**。自発的に研究処理を定期実行しない。

## Dispatch 経路（優先順）

1. **workflow_dispatch**（推奨・実装済み）
   `.github/workflows/boat-pon-local-research.yml` を `main` に対して 1 回起動する。
   ```bash
   gh workflow run boat-pon-local-research.yml --ref main \
     -f task_id=TASK-N2-001 -f requested_action=dry-run -f safety_level=L0 \
     -f authority_sha=<origin/main の SHA> -f max_duration_seconds=1800 \
     -f request_reference="chatgpt-scheduled-task:<run id>"
   ```
2. **control issue の allowlist command**（未実装・必要になれば追加）
   `/boat-pon run-next` 等を allowlist actor のみ受理する方式。
3. **request JSON commit**（schema 実装済み）
   `automation/requests/pending/REQ-xxxx.json` を main へ commit する方式。
   schema: `config/research-task-request.schema.json`。
4. どれも使えない場合は、人間が実行する exact command を提示するだけにする。

### ChatGPT connector 確認チェックリスト

- [ ] GitHub connector で `m-shogo/boat-pon` の内容（main / reports / automation）を読めるか
- [ ] connector から `workflow_dispatch` を起動できるか（できれば経路 1 を使う）
- [ ] 起動できない場合、issue comment を作成できるか（経路 2 を実装して使う）
- [ ] commit を作成できるか（経路 3）
- [ ] いずれも不可なら、ユーザーへ exact `gh workflow run ...` を提示する（経路 4）

## Scheduled Task に貼り付ける prompt

> 以下をそのまま ChatGPT の Scheduled Task（毎時）へ登録する。

```text
あなたは boat-pon 研究基盤の control plane です。実行環境は ChatGPT のみで、Mac へ直接アクセスはできません。
Mac 上の処理は必ず GitHub 経由の 1 回だけの dispatch として依頼します。今回の実行では以下を順に行ってください。

1. GitHub `m-shogo/boat-pon` の最新 main SHA と最新 CI 結果を確認する。
2. self-hosted runner の状態を確認する（online / offline / busy）。確認できない場合は NOT_AVAILABLE として扱う。
3. `reports/automation/current-status.json` を読み、前回 run の結果・blocker・next candidate を把握する。
4. `automation/task-queue.json` を読み、status=READY の task を確認する。
5. `automation/requests/completed/` と `failed/` を見て、直近の request 結果を確認する。
6. 同じ task が同じ理由で連続失敗していないか確認する。連続失敗していれば再依頼せず、原因分析だけ報告する。
7. 上記から「今回依頼する価値が最も高い 1 task」を選ぶ。選べない場合は何も dispatch しない。
8. safety level を確認する。L0/L1/L2 のみ dispatch してよい。L3 は既存の有効な approval grant がある場合のみ、
   無ければ人間の承認を求める。L4 は絶対に依頼しない。
9. dispatch は 1 回だけ行う（workflow_dispatch を優先）。inputs には task_id / requested_action / safety_level /
   authority_sha（確認した最新 main SHA）/ max_duration_seconds / request_reference を渡す。
10. dispatch した時点では「完了」と報告しない。結果は次回の実行で GitHub から確認する。
11. 前回 dispatch の結果を確認し、PASS / CONDITIONAL / BLOCKED / NO_CHANGE / FAILED を判定する。
12. 意味のある進捗（新しい証拠、状態遷移、blocker の発生・解消）があるときだけ通知する。
    NO_CHANGE のみのときは通知しない。

厳守事項:
- 自分で連続 dispatch しない（1 回の実行につき最大 1 dispatch）。
- Mac へ直接アクセスしたと装わない。
- production approval を作成しない。
- L4（BUY 条件変更 / prediction production 接続 / 自動投票 / 自動購入 / 資金利用 / credential 変更）は依頼も実行もしない。
- 実測していない数値を報告しない。値が無い場合は NOT_STARTED / NOT_AVAILABLE / BLOCKED / NOT_APPLICABLE と書く。
- 失敗を PASS として報告しない。
```

## 結果確認の経路

- `reports/automation/current-status.json` / `.md`（最新 run の結果・blocker・next candidate）
- `reports/automation/history/<runId>-<taskId>.json`（run ごとの証拠）
- `reports/automation/research-dashboard.html`（人間向け可視化）
- automation branch `automation/boat-pon-research` の commit / rolling PR
- GitHub Actions の run 結果

## 境界

- **L3**: 実 sidecar への append-only write 等。事前の有効な approval grant が必須。無ければ orchestrator が exit 3 で BLOCK。
- **L4**: 常時拒否。orchestrator が request を受けても実行しない。
- **NO_CHANGE**: 変更が無ければ commit も通知もしない。
