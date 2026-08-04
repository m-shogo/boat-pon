# boat-pon research dispatch runbook

更新: 2026-08-04

## 経路

| 経路 | trigger | 用途 | 状態 |
|---|---|---|---|
| request file commit | `push` main `automation/requests/pending/*.json` | **ChatGPT Scheduled Task の第一経路** | 実装・E2E 実証済み |
| workflow_dispatch | 手動 / gh CLI | operator の手動実行 | 実装済み（ChatGPT からは起動不可） |

**`on.schedule` / cron / launchd hourly / daemon は存在しない（禁止）。** 1 dispatch = 1 task。workflow は自分自身を再 dispatch しない。

## 1 回の流れ

1. request JSON を `automation/requests/pending/REQ-<id>.json` として main へ commit（1 件のみ）
2. `boat-pon-request-file-dispatch.yml` が起動（guard job → self-hosted runner job）
3. guard（ubuntu）が repo/actor/branch/event/追加件数/path/schema/digest/replay/safety を検証
4. runner が `automation:validate-request` → `automation:task` を実行（1 task のみ）
5. executor registry が taskType を解決（未登録は `EXECUTOR_NOT_REGISTERED` で BLOCK）
6. queue を `READY→CLAIMED→RUNNING→PASS/CONDITIONAL/BLOCKED/FAILED_*` へ atomic 遷移
7. 結果・証拠を `automation/boat-pon-research` branch へ commit（allowlist path のみ）
8. request outcome を `automation/requests/completed|failed/` へ記録（replay 防止）
9. runner は idle へ戻る。**次 task を自動起動しない**

## Executor registry

| taskType | executor | safety | 出力 |
|---|---|---|---|
| `dataset-canary` | N2 dataset canary（corrected truth, 固定月 cohort） | L2 | `reports/n2/n2-dataset-canary.json/.md` |
| `readonly-analysis` | corrected eligible 率・年代 drift 再集計 | L0 | `reports/n2/n2-corrected-eligibility.json` |
| `readonly-audit` | held-out win 返還欠落の別 defect 調査 | L0 | `reports/n2/n2-win-refund-omission-audit.json` |

未登録 taskType は `EXECUTOR_NOT_REGISTERED` で BLOCK し、queue は READY のまま維持する。
**NO_CHANGE を成功扱いにしない。** executor はすべて read-only（実 sidecar へ write しない）。
実データは `policy.dataRoot`（canonical repo path）から read-only で読む。

## 安全境界

- L0/L1/L2 のみ自動実行。L3 は既存 approval grant 必須（無ければ exit 3）。**L4 は常時拒否**。
- guard は fork / PR / 非 owner / 非 main / 複数 request / modified・deleted request / traversal / symlink を拒否。
- git write は allowlist path のみ、DB/archive/model artifact/大容量は拒否、force push・reset なし。
- 実行結果は automation branch へ。main へ研究結果を直接 push しない（request file は main、結果は branch）。

## 手動 command

```bash
pnpm automation:build-request -- --task-id=TASK-N2-001 --requested-action=run-task --safety-level=L2 --write
pnpm automation:validate-request -- --request=<path>
pnpm automation:task -- --request=<path>
pnpm automation:status
pnpm automation:pause / resume / emergency-stop / clear-emergency-stop
pnpm report:automation:dashboard
```
