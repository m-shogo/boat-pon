# Rule Candidate Migration Plan

`docs/rule-candidates.md`（週次レビューで手動運用してきた候補ログ）と、
`data/research-rules.json`（Phase 3で追加した型付きRule Lifecycle registry、
`src/domain/researchRule.ts` / `researchRuleStore.ts`）の用語を対応づけ、
今後どう統合していくかをまとめたドキュメントです。

**このドキュメント自体は移行を実行しない。** `docs/rule-candidates.md` の
既存候補を`data/research-rules.json`へ一括投入することもしない。
対応表と移行条件を先に固定し、実際の移行は候補1件ずつ、人が判断してから行う。

## `docs/rule-candidates.md` の現行運用

週次で以下を実行し、結果を`docs/rule-candidates.md`に手動またはスクリプトで追記する運用。

```text
report:weekly → report:monthly → walk:history → decision:dry-run → live反映候補
```

現行の判定ステータス（`docs/rule-candidates.md`の「判定ステータス」セクション）:

| status | 意味 | live反映 |
|---|---|---|
| `candidate` | 採用候補。複数期間で安定している | まだ直接反映しない |
| `watch` | 保留。サンプル不足または結果が割れている | 反映しない |
| `reject` | 除外候補。ROIや的中率が弱い | BUYへ昇格しない |
| `adopted` | 採用済み。理由と日付を残す | 反映済み |
| `reverted` | 戻したルール。理由を残す | 反映しない |

採用判断は「確定BUYが最低20件」「report:monthlyでROI>=1.0」「walk:historyでfail windowが少ない」
「decision:dry-runで不自然なBUYがない」の4条件を満たすかどうかという、**後ろ向き（backtest的）**
な基準で行われている。Phase 1で定義したForward Test（`isForwardTested`）の概念とは異なる。

## `data/research-rules.json` の今後の役割

`docs/rule-candidates.md`は「週次でどう判断したか」の**人間向けの記録・レビューログ**として
引き続き使う。`data/research-rules.json`は「型で守られた状態遷移を強制するための
**機械可読なレジストリ**」として使う。当面は両方を並行運用する（`docs/ai/04-ROADMAP.md`の
Phase 3残タスク参照）。

役割分担のイメージ:

- `docs/rule-candidates.md` — 週次レビューの経緯、ROI数値、判断理由を人が読む記録
- `data/research-rules.json` — 「このルールは今どの段階か」を`RuleStatus`型で保持し、
  `canTransitionRuleStatus`/`validateProductionEligibility`で不正な昇格を機械的に防ぐ

## Status Mapping

`docs/rule-candidates.md`のstatusは「後ろ向き検証でどう判断したか」、
`ResearchRule.status`は「Idea→Production→Archiveのどの段階か」という別の軸なので、
1対1の機械的対応にはならない。以下は**目安**であり、移行時は候補ごとに人が確認すること。

| `docs/rule-candidates.md` status | 意味 | `ResearchRule.status`の目安 | 移行時の注意 |
|---|---|---|---|
| `watch` | 保留・サンプル不足 | `candidate` | そのまま登録してよい。まだ何も検証が固まっていない段階 |
| `candidate` | 採用候補・複数期間で安定 | `candidate`（登録直後）。人が確認後に`backtest`以降へ手動で進める | `ResearchRule`の`candidate`は「アイデア段階」全般を指す言葉で、`docs/rule-candidates.md`の`candidate`（すでにreport:monthly等をある程度通過済み）とは検証の進み具合が違う。登録時に自動で`backtest`へ格上げしない |
| `reject` | 除外候補 | `deprecated`（さらに進めるなら`archived`） | 「二度と使わない」ではなく「今回は見送り」の記録として残す。理由は`reasonSummary`に必ず書く |
| `adopted` | 採用済み・live反映済み | `approved`、または将来`production`候補 | **自動で`production`にしない。** `docs/rule-candidates.md`の`adopted`はreport:monthly等の後ろ向き検証のみで採用されており、Phase 1のForward Test（`isForwardTested`）を経ていない。`research-rules.json`上で`production`にするには、`explore-roi.ts --json`等で実際に得た`RuleEvaluationResult`を`ForwardTestResult`として用意し、`validateProductionEligibility`を満たすことを確認してから昇格させる |
| `reverted` | 一度採用して戻した | `deprecated` | `production`または`approved`から`deprecated`への降格記録として使う |

## 移行してよい条件

候補1件について、以下をすべて満たす場合のみ`data/research-rules.json`へ登録してよい。

- `docs/rule-candidates.md`に記載された候補であり、内容（reasonSummary相当）を
  人が読んで理解している
- 上記status mappingの「移行時の注意」を踏まえた妥当な`ResearchRule.status`を
  人が選んでいる（AIが自動選択しない）
- `adopted`を`production`として登録する場合は、`validateProductionEligibility`を
  満たす`ForwardTestResult`が実際に存在する（`pnpm explore:roi -- --json`等で確認済み）

## 移行してはいけない条件

以下のいずれかに該当する場合は移行しない。

- `docs/rule-candidates.md`側の記載が古い・矛盾している・sample不足など、
  reject/watchに近い状態のまま放置されている候補
- `adopted`だが対応する`RuleEvaluationResult`/Forward Test記録が手元にない
  （このドキュメント作成時点でそのような候補が大半を占める）
- 候補を一括で自動移行しようとしている（1件ずつ人が確認する運用を保つ）
- 移行の目的が「Fableでの表示を試すため」など、Rule Lifecycle本来の目的と
  無関係な理由になっている

## AI単独判断禁止

- どの候補をどの`ResearchRule.status`に対応させるかは、このドキュメントの
  mapping表を**参考**にしつつ、最終的には人が1件ずつ判断する
- AIが`docs/rule-candidates.md`を読んで`data/research-rules.json`へ
  自動的に一括登録することはしない
- 特に`production`への登録は、`pnpm manage:research-rules -- transition`が
  要求する`ForwardTestResult`を人が用意した場合のみ行う。「良さそうだから」
  という理由でAIが`--evaluation-file`を捏造してはいけない

## 移行手順（1件ずつ）

```sh
# 1. 対象候補をdocs/rule-candidates.mdから読み、reasonSummaryを決める
# 2. dry-runで確認する（ファイルは書き換わらない）
pnpm manage:research-rules -- add --rule-id <id> --title "<title>" --reason "<reasonSummary>" --dry-run

# 3. 問題なければ実行する
pnpm manage:research-rules -- add --rule-id <id> --title "<title>" --reason "<reasonSummary>"

# 4. 必要な段階まで手動で進める（例: watch/candidate相当ならここで停止）
pnpm manage:research-rules -- transition --rule-id <id> --to backtest --dry-run
pnpm manage:research-rules -- transition --rule-id <id> --to backtest

# 5. adopted相当をproductionまで進める場合のみ、実際のForward Test結果を用意する
pnpm explore:roi -- --from <開始日> --to <終了日> --json > /tmp/eval.json
pnpm manage:research-rules -- transition --rule-id <id> --to production --evaluation-file /tmp/eval.json --dry-run
pnpm manage:research-rules -- transition --rule-id <id> --to production --evaluation-file /tmp/eval.json
```

`--dry-run`は必ず先に実行し、意図した遷移か・エラーにならないかを確認してから
本実行する。

## Rollback方法

- `data/research-rules.json`はgit管理下のプレーンJSONなので、
  `git checkout -- data/research-rules.json`（または該当コミットへの`git revert`）で
  いつでも移行前の状態へ戻せる
- SQLite DB・`app_settings`・`decision_history`には一切書き込んでいないため、
  この移行のrollbackが本番判定ロジックに影響することはない
- `docs/rule-candidates.md`側は移行によって変更しない（読み取り専用の参照元として扱う）ため、
  rollback時に復元すべき情報は`data/research-rules.json`の差分だけで完結する
