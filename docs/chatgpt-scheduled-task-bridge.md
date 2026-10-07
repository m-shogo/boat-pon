# ChatGPT Scheduled Task bridge（boat-pon / intent 方式）

## 2026-10-08 改訂版（これを使う）

### 旧運用の診断

1. **9/25 22:05（JST）を最後に、GitHub へ1件も書き込んでいない。** 最後の PR #2286 は CI が green でマージ可能なまま放置されている。ChatGPT 側でタスクが止まっているか、失敗している。ChatGPT のタスク画面で、状態とエラー（GitHub connector の認証切れなど）を確認する。
2. **ChatGPT からは DB が見えない。** 見えるのは GitHub 上のコードだけで、判定に必要な `data/boat.sqlite` は Mac の中にある。だから毎時タスクは「コードを直す」ことしかできず、8/15〜9/24 の 1,656 コミットの大半は研究基盤の補強になった。当たり外れの集計も edge の判定も、構造的に一度も回せなかった。
3. **毎時は頻度が合っていない。** レース結果は1日1回（21:30 の取り込み）しか確定しないので、毎時回しても新しい情報は無い。
4. 9/1 に Claude 側で予約した sharp money の検証も、最初の権限確認で中断されたまま「成功」扱いになっていた（その検証は 2026-10-07 にやり直して REJECT）。

### 新しい形

- **Mac**: 毎晩 22:15 に `scripts/publish-accuracy-scorecard.sh` を実行する。週1回の改善処理（市場補正の挑戦者評価）→ スコアカード（履歴・イベントの蓄積）→ 公開版（集計値だけ。レース ID・買い目・オッズは出さない）を `automation/scorecard` ブランチの `scorecard/latest.md` に置く、の順に動く。launchd への登録はユーザーが行う（テンプレートは `docs/launchd/com.boatpon.scorecard-publish.plist`）。
- **ChatGPT**: 1日1回（22:30 以降）、そのファイルだけを根拠に「当たり外れ」と「確率の精度」を報告する。週1回は目的監査をする。コミットは原則しない。
- 精度の物差しは **市場補正の確率**（T-5 市場に temperature 0.9 と late money を掛けたもの）。v3 の確率がこれより正確になったら「精度が上がった」と言える。2026-10-07 時点では、v3 のほうが不正確（全判定の logloss は v3 0.235 に対して市場補正 0.219、BUY では v3 の的中予測が実績の約3倍）。

### ChatGPT の定期タスクに貼り付けるプロンプト（毎日 22:30 JST）

```text
あなたは boat-pon の「当たり外れ報告と精度の監査」担当です。実行は1日1回です。
ChatGPT からは DB を見られません。数字は GitHub m-shogo/boat-pon の automation/scorecard ブランチにある
scorecard/latest.md（Mac が毎晩 22:15 に更新）だけを根拠にします。

前提（変えない事実）:
- 利益の edge は無いと確定している（main の docs/reviews/2026-10-07-strict-review.md）。利益や BUY 件数の増加を目標にしない。
- 目標は2つだけ。
  (1) BUY 通知の当たり外れを、公式払戻の精算どおりに正しく伝える。
  (2) 確率の精度（logloss・Brier・実績/予測）を、市場補正の確率を物差しにして測り、上げる。
- 自動投票・自動購入・ログイン・app_settings の変更・本番の判定ロジックの変更は、依頼も実装もしない。

毎日の手順:
1. scorecard/latest.md を読む。冒頭の「生成:」が 26 時間より古ければ、「Mac 側の集計が止まっている（launchd・スリープ・電源を確認）」とだけ報告して終える。コードは変更しない。
2. 当たり外れ: 「累計」の行（BUY・精算・的中・外れ・結果待ち・ROI）と、前回の報告からの増分をそのまま書く。数字を丸めたり推測で補ったりしない。
3. 精度: 「全判定」と「BUY のみ」の表から、v3 と市場補正の logloss・Brier・実績/予測を書く。v3 の logloss が市場補正より大きければ「v3 は市場より不正確」と書く。
4. 注意: 「注意」節の ⚠️ をすべて書き写す。【新規】が付いたものは、報告の先頭に置く。
   成長: 「成長」節の現在の王者と直近の評価（入れ替え・据え置き）を書く。入れ替えがあった日は、その旨を先頭に置く。
5. 提案は最大1件。次の形で書けるものだけを出す:「どの数字が・どれだけ・いつまでに動くか」（例: BUY での v3 の実績/予測を 0.5 以上にする、T-5 カバー率を 7日平均 70% 以上にする）。
   研究基盤の補強・ガード・ledger・contract・リファクタは提案しない。
6. コミットと PR は、5 の提案をユーザーが承認したあとだけ作る。マージはしない。open の PR があるあいだは新しく作らない。

週1回（日曜の実行）は、目的監査も行う:
- 直近7日の main へのコミットと PR のうち、scorecard の数字を動かしたものは何件か。0件が2週続いたら「この定期タスクを止めるか、週1回に減らす」と提案する。
- 結果待ちの BUY が3日以上残っていないか（結果の取り込みが止まっていないか）。
- 4週続けて精度（v3 の logloss・BUY での実績/予測）が良くならなければ、「v3 の精度改善は打ち止め。表示を市場補正の確率に切り替える」と提案する。

厳守:
- 実測していない数値を書かない。無い値は「不明」と書く。
- 止まっているもの・失敗したものを「成功」と書かない。
- 1回の実行で作るコミットは原則0件（報告だけ）。
```

### 旧版との違い

| | 旧（2026-08-04〜09-25） | 新（2026-10-08〜） |
|---|---|---|
| 頻度 | 毎時 | 毎日1回 + 週1回の目的監査 |
| 根拠 | コードとキューの状態 | Mac が毎晩出すスコアカード（実データの集計） |
| 出力 | intent やコードのコミット・PR・マージ | 報告だけ（コミットは承認後のみ・マージしない） |
| 目標 | 次のタスクを進める | 当たり外れを正しく伝える・確率の精度を上げる |
| 止める条件 | なし | 数字が動かない週が続いたら止める・頻度を下げる |

---

## 旧版（2026-08-04〜09-25 の運用。使わない）


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
