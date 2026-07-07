# Daily Research Report

Phase 5（`src/domain/dailyResearchReport.ts` + `pnpm daily:research-report`）、
Phase 5.1（複数ルール横断レポート、`--rules-file`）、Phase 5.2（`ResearchRule`ごとの
評価条件によるrule-specific ROI/Drift評価、`src/domain/researchRuleConditions.ts`）の
最小実装を、実際にどう扱うかをまとめたメモです。ROI計算・Drift判定・Rule Lifecycle
状態遷移のロジックはこのドキュメントの対象外（引き続き
`src/domain/researchEvaluation.ts` / `researchDrift.ts` / `researchRuleStore.ts`が
担当。`docs/ai/10-DRIFT-OPERATIONS.md`と同じ原則）。

## Daily Reportの目的

- ROI Explorer（Phase 2、`pnpm explore:roi`）とDrift Detection（Phase 4/4.1、
  `pnpm detect:drift`）の結果を、1日1回読める形の**研究レポート**にまとめること
- 「今日買うべきかどうか」を決めるツールではない。「今の仮説がどういう状態にあるか」を
  俯瞰するためのツール
- `pnpm daily:research-report`はread-onlyのadhoc CLIであり、常時実行デーモンでも
  自動売買判断でもない。実行者（人間）が都度叩く運用を前提にする

## 買い推奨ではないこと

- `DailyResearchReport`の`findings`/`nextActions`は、必ず「要検証」「見送り」「候補」
  「経過観察」といった研究用語に留める。「買い」「採用確定」「除外確定」のような
  断定表現は使わない（`buildDailyResearchFindings`/`buildDailyResearchNextActions`の
  実装ルール）
- `nextActions`の末尾には常に「このレポートはROI/Drift検証の要約であり、購入推奨・
  Production昇格の判断根拠にはしない」という注記が入る
- `roiSummary.isForwardTested`/`isProductionEligible`はROI Explorer側の結果を
  そのまま表示するだけで、この値を根拠にレポート側が「もう買ってよい」と言うことはない

## AI単独判断禁止

- Daily Reportの`findings`/`nextActions`は、あくまで研究上の気づき・次の一歩の候補
  であり、AIやCLIがこれを見て自動でルール採用・Production昇格・除外を行うことはしない
- 状態遷移が必要な場合は、引き続き人間が`pnpm manage:research-rules`と
  `docs/ai/09-RULE-CANDIDATE-MIGRATION.md`の手順に従って判断する
- BUYは検証候補、ROIは検証指標（`CLAUDE.md`の絶対禁止事項と同一）。Daily Reportの
  findingsが`attention`（Drift severity=critical相当）であっても、それを見てAIが
  単独で「このルールは危険だから除外する」と`research-rules.json`や`app_settings`を
  書き換えることはしない

## Forward未通過ルールの扱い

- `roiSummary.isForwardTested`が`false`の場合、`buildDailyResearchFindings`は必ず
  `forward-test-not-passed`（severity: `watch`）というfindingを追加する
- このfindingの文言は「このROIはcandidate/backtest段階の参考値であり、購入推奨では
  ない」と明記し、`nextActions`にも「Forward Testを継続し、サンプルサイズが十分になって
  から再評価する」という研究用語のアクションを追加する。severityを`attention`まで
  引き上げることはしない（Forward未通過は「まだ検証中」であって「危険」ではないため）

## Driftの扱い

- `driftSummary`は`pnpm detect:drift`と同じ`buildDriftDetectionResult`の結果を
  そのまま要約するだけで、severityやsignalsを再判定しない
- severityと`findings`のseverityは別軸: Drift側の`severity`（none/watch/warning/
  critical/unknown）をそのまま、Daily Report側の研究トーンな3段階
  （`info`/`watch`/`attention`）へ**言い換える**だけで、悪化の強さの判定自体は
  変えない。マッピングは固定（`none`→`info`、`watch`/`warning`→`watch`、
  `critical`→`attention`、`unknown`→`watch`）
- `severity=critical`（`findings`では`attention`）でも、文言には必ず
  「この結果だけでルールの除外・降格を断定はしない（AI単独判断禁止）」という注記を含める
- `--presentation-json`の`driftSummary`は、既存の`DriftDetectionPresentation`
  （`src/presentation/driftPresentationModel.ts`、Phase 4.1）をそのまま再利用する。
  `severityLabel`等をDaily Report側で作り直すことはしない（整合性を保つため）
- `--rules-file`を指定しない場合（Phase 5から無変更）は固定の`daily-research-report-adhoc`
  というruleIdで動き、`ruleTitle`/`ruleStatus`は常に`null`になる
- `--rules-file`を指定した場合（Phase 5.1）は、各ルールのdriftSummaryに
  `ruleTitle`/`ruleStatus`が入り、statusが`"production"`以外なら
  「confirmed production incidentとして扱わない」という注記が`warnings`に自動で入る
  （`buildDriftDetectionViewModel`のPhase 4.1ロジックをそのまま再利用しているだけで、
  Phase 5.1で新しい判定は追加していない）
- Phase 5.2では、baseline/recent両方のdrift評価窓にも、そのルールの
  `evaluationConditions`（有効なもののみ）を適用してから`buildDriftDetectionResult`を
  計算する。recent側のsampleSizeが不足する場合の`severity: "unknown"`扱いは、既存の
  `src/domain/researchDrift.ts`の`MIN_DRIFT_SAMPLE_SIZE`判定をそのまま使う（Drift側の
  判定ロジックには一切手を入れていない）

## 複数ルールDaily Report（Phase 5.1）

`--rules-file <path>`を指定すると、単一adhocレポートの代わりに`data/research-rules.json`
形式（`{ rules: ResearchRule[] }`）のファイルを読み、複数ルールを横断した
`DailyResearchReportAggregate`を出力する。

- **read-onlyであること**: `--rules-file`はファイルを`existsSync`+`readFileSync`で
  読むだけ。`writeFileSync`はコード上どこにも存在しない。実際の`data/boat.sqlite`や
  `data/research-rules.json`を書き換えることは一切ない
- **実候補をAIが勝手に追加しないこと**: このCLIは`research-rules.json`に何も書き込まない。
  ルールの新規登録・状態遷移は引き続き`pnpm manage:research-rules`を人が実行する
  （`docs/ai/09-RULE-CANDIDATE-MIGRATION.md`参照）。Daily Reportの`findings`/
  `overallNextActions`を見てAIが自動でルールを追加・登録することはしない
- **archivedルールの扱い**: 初期状態（`--rules-file`指定時のデフォルト）では
  `status: "archived"`のルールを集計から除外する。`--include-archived`（archivedも
  含める）はまだ実装していない。Phase 5.2以降の候補としてここに残す
- **ルール固有条件が無い場合の制約**: `evaluationConditions`を持たないルール（後述の
  Phase 5.2参照）は、依然として共通のdecision_history集計をruleId/title/statusで
  ラベル付けしただけのものになる。これを隠さず、各ルールの`warnings`に
  「ルール固有の条件では絞り込んでいない」旨を必ず1件残す（ブラックボックス禁止の原則。
  複雑な条件でのルール別ROIが必要な場合は引き続き`analyze:*`系の専用スクリプトを使う）
- **Production未満のルールをProduction扱いしないこと**: 各ルールのstatusが
  `"production"`以外なら、`findings`に「このルールはProductionに達しておらず、
  この評価をProduction運用実績として扱ってはいけない」旨のfindingが必ず入る
  （`rule-status-not-production`）
- **買い推奨・Production昇格・自動採用ではないこと**: `overallNextActions`の末尾には
  常に「このレポートは複数ルールのROI/Drift検証の要約であり、購入推奨・Production昇格・
  自動採用の判断根拠にはしない」という注記が入る
- **ファイルが無い/パースできない場合**: 警告を出して単一adhocレポート（Phase 5と同じ
  従来動作）へフォールバックする。例外を投げてCLIが落ちることはない
- **`--rules-file`を指定しない場合**: Phase 5から完全に無変更（単一adhocレポートのまま）

## Rule-specific evaluation（Phase 5.2）

Phase 5.1では全ルールが共通集計のラベル付けだったが、Phase 5.2で`ResearchRule`に
`evaluationConditions`（省略可能・後方互換）を追加し、条件があるルールはその条件で
decision_historyの行を絞り込んでからROI/Driftを評価できるようにした。

### evaluationConditionsの形

```json
{
  "ruleId": "wind24-exh1-switch",
  "status": "forward",
  "evaluationConditions": [
    { "key": "venue", "operator": "equals", "value": "桐生" }
  ]
}
```

- `operator`は現時点で`"equals"`のみ。範囲条件・OR条件・正規表現・任意JS式は
  **意図的に対象外**（今後追加するとしても、都度allowlistへ明示的に追加する設計であり、
  任意のJS式やSQL文字列を実行できるようにはしない）
- `key`はallowlist方式。対応するのは既存のROI Explorer条件フィルタ
  （`src/domain/researchEvaluation.ts`の`SUPPORTED_CONDITION_KEYS`）と同じ
  `venue`/`raceNo`/`decision`のみ。それ以外のkeyは`unknown evaluation condition key`
  としてwarningに積まれ、無視される（例外は投げない）
- `evaluationConditions`を省略した場合は、Phase 5.1までと同じ挙動（共通集計の
  ラベル付け、`shared-fallback`）のまま。既存の`data/research-rules.json`は
  この項目を持たないため、そのまま読み込める（後方互換）

### evaluationScopeの3値

| evaluationScope | 意味 |
|---|---|
| `rule-specific` | 有効な条件が1つ以上あり、その条件でROI/Driftを絞り込んで評価した |
| `shared-fallback` | `evaluationConditions`が未指定・空配列。従来通り共通集計をそのまま使う |
| `invalid-condition-fallback` | `evaluationConditions`は指定されているが、全て無効
（unsupported operator・unknown key）だったため、安全側に倒して共通集計へfallbackした |

`isRuleSpecificEvaluation`は`evaluationScope === "rule-specific"`と同値の冗長フィールド。
`conditionSummary`は実際に適用された有効な条件の表示用文字列（例:
`venue equals "桐生"`）、`conditionWarnings`はunsupported operator/unknown key等の
警告文言。

### 安全側に倒す設計

- **allowlist方式**: 未知のkey・未対応のoperatorはthrowせず、その条件だけを無視して
  warningに積む（`validateResearchRuleConditions`）。1つのルールの条件が一部無効でも、
  有効な条件だけで`rule-specific`評価を続行する（部分適用）
- **全滅時は共通集計へfallback**: 有効な条件が1つも無ければ`invalid-condition-fallback`
  として、共通集計と同じ評価結果になる（`applyResearchRuleConditions`がrowsを
  そのまま返すため、追加のフォールバック分岐を書く必要が無い設計）
- **条件適用後にsampleSizeが不足しても、既存の安全装置がそのまま働く**:
  `sample-size-insufficient`finding（`MIN_PRODUCTION_SAMPLE_SIZE`未満）、
  Drift側の`severity: "unknown"`（`MIN_DRIFT_SAMPLE_SIZE`未満）は、Phase 5/5.1から
  一切変更していない。rule-specific評価でサンプルが減っても、強い結論を出す新しい
  ロジックは追加していない
- **既存のROI Explorer条件フィルタを再利用**: `applyResearchRuleConditions`は
  `src/domain/researchEvaluation.ts`の`applyCondition`をそのまま呼ぶだけで、
  行フィルタのロジックを重複実装していない
- **SQL文字列生成・任意コード実行は無い**: 条件適用は配列の`.filter()`のみで、
  decision_historyへのSQLクエリはCLI側の既存の日付範囲SELECTのまま変更していない。
  `eval`/`new Function`等は一切使っていない

### 買い推奨・Production昇格の判断には使わないこと

- rule-specific評価であっても、findings/nextActionsの文言は「要検証」「見送り候補」
  「経過観察」等の研究用語に留める。「買い」「利益確定」「採用確定」「Production昇格
  可能」のような断定表現は使わない
- rule-specific評価で高ROIが出ても、それだけでAIがルールを昇格・採用することはない。
  状態遷移は引き続き人間が`pnpm manage:research-rules`で判断する

## Phase 5 / 5.1 / 5.2でやること / やらないこと

やること（今回実装した範囲）:

- ROI Explorer 1件 + Drift Detection 1件を要約した単一の`DailyResearchReport`を、
  read-onlyのCLIから`--json`/`--presentation-json`で出力する（Phase 5、無変更のまま維持）
- Forward未通過・サンプル不足・Drift悪化を、断定を避けた研究用語のfindings/
  nextActionsとして表示する
- `driftSummary`をPresentation層でPhase 4.1の`DriftDetectionPresentation`と
  整合させる
- `--rules-file`による複数ルール横断レポート（`DailyResearchReportAggregate`）を
  read-onlyで追加し、Production未満のルールを明示する安全装置を組み込む（Phase 5.1）
- `ResearchRule.evaluationConditions`（equalsのみ、allowlist方式）によるrule-specific
  ROI/Drift評価、`evaluationScope`の3値による透明性の確保（Phase 5.2）

やらないこと（残タスク、今回は着手しない）:

- 範囲条件・OR条件・正規表現・任意JS式による評価条件（equals以外のoperatorは対象外）
- `--include-archived`（archivedルールを含める表示オプション）
- 新仮説の自動発見・提示（Pattern Discovery相当の統合）
- `OpportunityPresentation`（★スコア）・`RuleCardPresentation`との統合
- `docs/rule-candidates.md`の候補一覧との接続
- `reports/*`への自動出力・保存（現状は標準出力にJSONを出すだけで、ファイル書き込みは
  一切行わない）
- 通知連携（LINE/Web Push等）
- 本物のFable（F#/.NET）による描画。`--presentation-json`の出力はrenderer非依存の
  データ契約であり、実際にレンダリングするReact/Fableコンポーネントはまだ無い

## 実行例

```sh
# 単一adhocレポート（Phase 5、従来通り）
pnpm daily:research-report -- --date 2026-07-06 --json
pnpm daily:research-report -- --date 2026-07-06 --presentation-json

# 複数ルール横断レポート（Phase 5.1、data/research-rules.json形式のファイルをread-onlyで読む）
# evaluationConditionsを持つルールはrule-specific評価、持たないルールはshared-fallbackになる（Phase 5.2）
pnpm daily:research-report -- --date 2026-07-06 --rules-file ./tmp/research-rules-fixture.json --json
pnpm daily:research-report -- --date 2026-07-06 --rules-file ./tmp/research-rules-fixture.json --presentation-json
```

`--date`を省略すると当日（UTC）になる。ROI集計窓は`--date`までの全期間、Drift比較窓は
「直近30日」対「それより前の全期間」（暫定値、`docs/ai/10-DRIFT-OPERATIONS.md`と同様
実運用実績を見て見直す前提）。DB/Raw Dataへの書き込みは一切行わない。`--rules-file`も
read-onlyで、実際の`data/research-rules.json`を書き換えることはない。
