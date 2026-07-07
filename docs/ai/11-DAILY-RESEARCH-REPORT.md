# Daily Research Report

Phase 5（`src/domain/dailyResearchReport.ts` + `pnpm daily:research-report`）の最小実装を、
実際にどう扱うかをまとめたメモです。ROI計算・Drift判定・Rule Lifecycle状態遷移の
ロジックはこのドキュメントの対象外（引き続き`src/domain/researchEvaluation.ts` /
`researchDrift.ts` / `researchRuleStore.ts`が担当。`docs/ai/10-DRIFT-OPERATIONS.md`と
同じ原則）。

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
- 現状の`pnpm daily:research-report`は`--rule-id`の`research-rules.json`連携を
  していない（固定の`daily-research-report-adhoc`というruleIdで動く）。そのため
  `ruleTitle`/`ruleStatus`は常に`null`になる。ルールごとのDaily Reportは
  Phase 5残タスク

## Phase 5でやること / やらないこと

やること（今回実装した範囲）:

- ROI Explorer 1件 + Drift Detection 1件を要約した単一の`DailyResearchReport`を、
  read-onlyのCLIから`--json`/`--presentation-json`で出力する
- Forward未通過・サンプル不足・Drift悪化を、断定を避けた研究用語のfindings/
  nextActionsとして表示する
- `driftSummary`をPresentation層でPhase 4.1の`DriftDetectionPresentation`と
  整合させる

やらないこと（Phase 5の残タスク、今回は着手しない）:

- 複数ルールを1つのレポートにまとめる機能（`data/research-rules.json`の全件走査）。
  現状は固定の単一ruleId（`daily-research-report-adhoc`）のみ
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
pnpm daily:research-report -- --date 2026-07-06 --json
pnpm daily:research-report -- --date 2026-07-06 --presentation-json
```

`--date`を省略すると当日（UTC）になる。ROI集計窓は`--date`までの全期間、Drift比較窓は
「直近30日」対「それより前の全期間」（暫定値、`docs/ai/10-DRIFT-OPERATIONS.md`と同様
実運用実績を見て見直す前提）。DB/Raw Dataへの書き込みは一切行わない。
