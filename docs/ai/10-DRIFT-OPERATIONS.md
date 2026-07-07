# Drift Operations

Phase 4（`src/domain/researchDrift.ts` + `pnpm detect:drift`）と Phase 4.1
（`src/view-models/driftViewModel.ts` / `src/presentation/driftPresentationModel.ts` /
`--presentation-json` / `--rule-id`の`research-rules.json`読み取り連携）を、実際に
どう運用するかをまとめたメモです。ROI計算・Forward Test判定・Rule Lifecycle状態遷移の
ロジックはこのドキュメントの対象外（引き続き`src/domain`が担当、`docs/ai/06-FABLE-READINESS.md`
の原則と同じ）。

## Drift Detectionの運用方針

- `pnpm detect:drift`はbaseline期間とrecent期間の2つの`RuleEvaluationResult`を比較する
  **read-onlyのadhoc比較ツール**であり、常時監視デーモンでも自動アラートでもない
- 実行者（人間）が`--baseline-from/--baseline-to/--recent-from/--recent-to`を都度指定して
  手動で叩く運用を前提にする。閾値（`DRIFT_ROI_DELTA_*`, `MIN_DRIFT_SAMPLE_SIZE`）は暫定値
  であり、実運用実績が増えたらレビューする
- `--json`は`DriftDetectionResult`（Phase 4の元の形、後方互換を維持）、
  `--presentation-json`は`DriftDetectionPresentation`（Phase 4.1、renderer向けに整形済み）
  を出力する。どちらもDB/`research-rules.json`への書き込みは一切行わない
- 複数ルールを一括で回したい場合は、現状シェル側でruleId/条件を変えながら複数回実行する
  運用になる（CLI自体に一括判定機能はまだ無い）

## severityの意味

`src/domain/researchDrift.ts`の`DriftSeverity`は以下の5段階（`severityLabel`はPhase 4.1の
表示ラベル、判定ロジックには影響しない）。

| severity | severityLabel | 意味 |
|---|---|---|
| `none` | No drift | recentサンプルが十分で、ROI悪化が閾値未満 |
| `watch` | Watch | ROI悪化が軽微（`DRIFT_ROI_DELTA_WATCH`以上）。様子見でよいレベル |
| `warning` | Warning | ROI悪化が明確（`DRIFT_ROI_DELTA_WARNING`以上、またはrecentサンプル不足） |
| `critical` | Critical | ROI悪化が大きい、またはbaselineが黒字でrecentが赤字に転落した崩壊候補（`roiCollapse`） |
| `unknown` | Unknown (insufficient data) | recentサンプルが0で判定不能 |

**severityは常に「ROI/サンプルサイズの事実」に基づく判定であり、「このルールが
Productionで壊れた」という運用上の断定ではない。** その断定を避けるための仕組みが
次節。

## production以外のルールの扱い

Drift自体はROI悪化の事実を検知するだけで、そのルールが現在どのライフサイクル段階
（`src/domain/researchRule.ts`の`RuleStatus`: candidate/backtest/forward/review/approved/
production/deprecated/archived）にあるかは知らない。Phase 4.1で追加した
`--rule-id`連携は、この文脈を**表示のためだけに**補うものであり、判定を変えない。

- `--rule-id <id>`が`data/research-rules.json`に存在すれば、そのルールの`title`/`status`が
  `ruleTitle`/`ruleStatus`として出力に添えられる。存在しなければ`null`（adhoc rule）のまま
- `ruleStatus`が`"production"`以外の場合、`DriftDetectionViewModel`/`DriftDetectionPresentation`の
  `warnings`に「このdriftをconfirmed production incidentとして扱ってはいけない」という注記が
  自動で1件追加される。candidate/backtest/forward段階のルールの悪化は、あくまで
  検証段階の悪化であり、本番運用の崩壊ではない
- **この注記は表示レベルの安全装置であり、severity自体は変えない。** severityが`critical`
  でも、statusが`production`でなければ「production崩壊」と読んではいけない
- `data/research-rules.json`は常にread-only（`existsSync` + `readFileSync`のみ、
  `writeFileSync`は一切呼ばない）。ファイルが存在しない・パースできない・該当ruleが無い
  場合は静かにadhoc rule扱いへフォールバックする（例外を投げない）

## Daily Report接続前の制約

- `DriftSummaryViewModel`/`DriftSummaryPresentation`（複数drift一覧用の型）はPhase 4.1で
  型だけ用意したが、CLIからはまだ単一drift出力にしか使っていない。複数ルールをまとめて
  1つのレポートにする実装はPhase 5（Daily Research Report）待ち
- Phase 5で複数drift一覧を実際にレンダリングする前に、`ResearchSummaryPresentation`との
  統合方法（別セクションとして並べるのか、`RuleCardPresentation`に埋め込むのか）を
  改めて判断する必要がある。今回はその判断をしていない
- React/Fableどちらのrendererもまだ実装していない（`src/renderers/fable/`は
  `OpportunityPresentation`/`LifecyclePresentation`の2つのみ。Drift用のrendererは
  今回のスコープ外。詳細は`docs/ai/06-FABLE-READINESS.md`）

## AI単独判断禁止

- Drift Detectionの結果（severity/signals/warnings）は、あくまで検証指標であり、
  ルールの状態遷移・Production昇格・購入指示を自動で行う根拠にはしない
- `--rule-id`連携で`ruleStatus`が見えるようになっても、**AIやCLIがそれを見て自動で
  `pnpm manage:research-rules -- transition`を実行する、といった自動昇格・自動降格は
  行わない。** 状態遷移は引き続き人間が`docs/ai/09-RULE-CANDIDATE-MIGRATION.md`の手順に
  従って判断する
- BUYは検証候補、ROIは検証指標（`CLAUDE.md`の絶対禁止事項と同一）。Drift検知結果を見て
  「このルールは危険だから今すぐ除外すべき」とAIが単独で判断し、`research-rules.json`や
  `app_settings`を書き換えることはしない
