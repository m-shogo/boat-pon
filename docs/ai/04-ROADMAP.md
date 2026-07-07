# Roadmap

Boat Pon AI Development Bible を実装可能な単位に分割したものです。
各Phaseは「設計 → 実装 → テスト → 検証 → Commit → Push → 停止」の1セットで進め、
1セッションでPhaseをまたいで大きく実装しない。

状態の凡例: `not started` / `in progress` / `done`

## Phase 1: Research Foundation — `done`（最小実装）

目的: ルール（仮説）のライフサイクルと評価結果を型として表現する土台を作る。DB・UI・自動化はまだ含めない。

- [x] Raw data保護方針 — 既存の `CLAUDE.md` 絶対禁止事項 + `docs/ai/00-VISION.md` に明文化済み（新規実装なし、既存方針の再確認）
- [x] Rule lifecycle model — `src/domain/researchRule.ts` の `RuleStatus`（candidate/backtest/forward/review/approved/production/deprecated/archived）
- [x] Hypothesis status model — `src/domain/researchRule.ts` の `ResearchRule`
- [x] Evaluation metadata — `src/domain/researchRule.ts` の `EvaluationMetadata`（dataWindowStart/End, evaluationRunAt, sampleSize）
- [x] Future Leak防止ルール — `EvaluationMetadata` で評価対象データ期間と評価実行時刻を必ず分離して記録する形にした（今後、生成コード側で `dataWindowEnd <= evaluationRunAt` を検証する処理はPhase 2以降で追加）
- [x] Forward Testの最小設計 — `ForwardTestResult`（`RuleEvaluationResult` に `isForwardTested: true` を強制した型）と `validateProductionEligibility` / `canTransitionRuleStatus`

### 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchRule.ts` | `RuleStatus`, `ResearchRule`, `EvaluationMetadata`, `RuleEvaluationResult`, `ForwardTestResult` |
| `src/domain/researchRuleLifecycle.ts` | `canTransitionRuleStatus(from, to)`, `validateProductionEligibility(rule, evaluation)`, `MIN_PRODUCTION_SAMPLE_SIZE`, `MIN_PRODUCTION_CONFIDENCE` |
| `src/domain/researchRuleLifecycle.test.ts` | ライフサイクルの安全装置のテスト |

### 未接続・未決定事項（TODO、Phase 2以降で判断）

- `ResearchRule` / `RuleEvaluationResult` はまだDBに保存されない（純粋な型とロジックのみ）。永続化は既存の `server/db.ts` に相乗りするか専用テーブルを作るか要判断
- `MIN_PRODUCTION_SAMPLE_SIZE = 200` は `CLAUDE.md` の「風速2〜4×1号艇展示1位」候補が forward n>=200 を格上げ条件にしていることに合わせた仮の値。他ルールにも一律適用してよいかは要レビュー
- `MIN_PRODUCTION_CONFIDENCE = 0.8` は暫定値。Bayesian Estimateの計算方法とセットで見直す
- ~~`dataWindowEnd <= evaluationRunAt` のFuture Leakチェックは型定義のみで、実行時バリデーション関数はまだ無い~~ → Phase 2 の `validateEvaluationMetadata` で解消済み

## Phase 2: ROI Explorer — `in progress`

目的: 条件別ROI集計を、Phase 1の型に載せて再利用可能にする。

- [x] sample size / hit rate / ROI / confidence を1つの結果オブジェクトにまとめる — `src/domain/researchEvaluation.ts` の `buildRuleEvaluationResult`（確定BUY行のみで集計、window外行は除外）
- [x] JSON出力 — `pnpm explore:roi -- --json` で `RuleEvaluationResult` をそのまま出力
- [x] CLI実行 — `scripts/explore-roi.ts`（`pnpm explore:roi`）。`--from/--to/--rule-id/--condition/--json`。DB・テーブル欠損時は空評価+warningsで正常終了
- [x] Future Leak実行時チェック — `validateEvaluationMetadata`（start<=end、end<=evaluationRunAt、sampleSize>=0、欠損はwarnings）。Phase 1 の未決定事項を解消
- [x] ROIを `payout_yen`（実払戻）優先に切替 — `realizedPayoutYen` が `payout_yen` をstakeへスケールして優先使用し、無い行のみ `current_odds` へfallback。fallback件数は `currentOddsFallbackWarning` で明示、`reasonSummary` に採用basis（payout_yen/current_odds fallback/mixed）を記録
- [x] 条件フィルタ（最小） — `--condition key=value` を追加。対応key: `venue` / `raceNo` / `decision`。単一条件のみ、AND/OR組み合わせは対象外。不正形式（`=`無し）はエラー、未対応keyはwarningで絞り込みスキップ
- [ ] 会場/月/オッズ帯など条件フィルタの拡充、複数条件のAND/OR対応

### Phase 2 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchEvaluation.ts` | `validateEvaluationMetadata`, `estimateConfidence`, `realizedPayoutYen`, `computeMaxDrawdown`, `currentOddsFallbackWarning`, `buildRuleEvaluationResult`, `parseCondition`, `applyCondition` |
| `src/domain/researchEvaluation.test.ts` | metadata安全装置・payout_yen優先/fallback・条件フィルタのテスト（12件） |
| `scripts/explore-roi.ts` | 最小ROI Explorer CLI（read-only、`--condition`対応） |

### Phase 2 正式検証状況

この開発環境（Claude Code実行環境）では `pnpm install` が完了しない — `registry.npmjs.org`
へのメタデータ取得が常時403、tarball取得も断続的に403（`x-deny-reason: host_not_allowed`）。
org policy denialであり、既に複数回・別パッケージでリトライして非一時的な遮断であることを
確認済み。**この環境ではこれ以上 `pnpm install` を再試行しない。** そのため以下は
**この環境では未実行**:

- `pnpm typecheck`
- `pnpm test`
- `pnpm explore:roi -- --json`

代替として、コミット済みソースをそのまま `node --experimental-strip-types --test`（scratchpad
上の一時コピーにimport拡張子`.ts`のみ付与、コミット物は変更なし）で実行し、Phase 1+2 合計
**17/17 テストpass** を確認。`explore-roi.ts` も同方式でフィクスチャSQLite DBに対して実行し、
payout_yen優先ROI・fallback・`--condition venue=...`・不正condition形式のエラー・未対応key
のwarningを検証済み。この代替手順は `pnpm run verify:strip-types` / `pnpm run verify:roi-smoke`
として自動化済み（`node_modules`不要、Node標準機能のみ）。詳細は `docs/ai/05-VERIFICATION.md`
のチェックリストを参照。

**Phase 3（Rule Lifecycle実装）に着手する前に、通常のpnpm環境に入り次第、上記3コマンドの
正式合格を確認すること。** 失敗した場合はこのセクションに結果を追記する。

### Phase 2 残タスク・未決定事項（TODO）

- 条件フィルタの拡充（月・オッズ帯など）、複数条件のAND/OR対応は依然未着手
- `estimateConfidence` は n/(n+50) の暫定縮小（n=200で0.8）。Bayesian Estimate導入時に置き換える
- `maxDrawdown` は累積BUY損益のピーク→谷を総投入額で割った暫定定義。定義の妥当性を採用判断前にレビューする
- `explore-roi.ts` のCLI経路自体の自動テストはない（アダプタ関数のテストで代替）。DBフィクスチャを使ったCLIテストはPhase 3以降で検討
- 通常pnpm環境での `pnpm typecheck` / `pnpm test` / `pnpm explore:roi -- --json` の正式実行が未確認（上記参照）

## Phase 2.5: Fable-ready View Contract — `done`（最小実装）

目的: Fableをまだ導入せず、将来React/FableどちらからでもResearch Engineの出力を
描画できる安定した表示契約を先に作る。詳細な判断根拠は `docs/ai/06-FABLE-READINESS.md`
を参照。

- [x] UIフレームワーク非依存の表示契約型 — `src/view-models/researchViewModel.ts`
      （`RuleCardViewModel`, `OpportunityScoreViewModel`, `WarningBadgeViewModel`,
      `RuleLifecycleStepViewModel`, `EvaluationMetricViewModel`, `ResearchSummaryViewModel`）
- [x] `RuleEvaluationResult`/`ResearchRule` → ViewModel 変換 — `src/view-models/researchViewModel.adapters.ts`
      （`buildRuleCardViewModel`, `buildOpportunityScoreViewModel`, `buildWarningBadges`,
      `buildLifecycleStepViewModel`, `buildResearchSummaryViewModel`）。ROI/Forward判定/
      Production判定はここでは計算し直さず、`src/domain` の結果をそのまま使う
- [x] `scripts/explore-roi.ts --view-json` — 既存 `--json`（`RuleEvaluationResult`そのまま）
      は無変更。`--view-json`は `ResearchSummaryViewModel` を出力する新オプション
- [x] Fable導入判断メモ — `docs/ai/06-FABLE-READINESS.md`

### Phase 2.5 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/view-models/researchViewModel.ts` | 表示契約の型定義のみ |
| `src/view-models/researchViewModel.adapters.ts` | 変換関数（`deriveRiskLevel`, `summarizeReason` 含む） |
| `src/view-models/researchViewModel.adapters.test.ts` | 安全装置のテスト |
| `scripts/explore-roi.ts` | `--view-json` 追加 |
| `docs/ai/06-FABLE-READINESS.md` | Fable導入前チェックリスト |

### Fable導入前の残タスク

`docs/ai/06-FABLE-READINESS.md` の「Fable導入前に必要な条件」参照。特に:

- `src/view-models/` の型が `explore-roi.ts` 単一カード以外の実運用（複数カード・
  Daily Report）を経ておらず、まだ「固まった」とは言えない
- Phase 3（Rule Lifecycle永続化）が終わるまで、`ResearchRule` はstatus履歴を持たず、
  `RuleLifecycleStepViewModel` のdeprecated/archived表現は簡略化したまま
- Fableは実装コストの具体的な不満が出てから検討する。現時点で導入を急ぐ理由はない

### Phase 3進行条件（更新）

Phase 3着手前提は変わらず: 通常pnpm環境で `pnpm typecheck` / `pnpm test` /
`pnpm explore:roi -- --json` が正式合格していること。加えて、Phase 2.5で追加した
`src/view-models/*.test.ts` も同じ `pnpm test` に含まれるため、これも合格対象に含まれる。

## Phase 2.6: Presentation Layer — `done`（最小実装、Fable導入直前の最終フェーズ）

目的: Fableをまだ導入せず、React/Fableどちらのレンダラーからも同じ形で消費できる
renderer非依存の最終表示契約（Presentation Layer）を作る。詳細は
`docs/ai/07-PRESENTATION-LAYER.md` を参照。

- [x] Presentation Models — `src/presentation/presentationModel.ts`
      （`RuleCardPresentation`, `OpportunityPresentation`, `WarningPresentation`,
      `LifecyclePresentation`, `MetricPresentation`, `ResearchSummaryPresentation`）
- [x] Presentation Builders — `src/presentation/presentationBuilder.ts`
      （`src/view-models` のViewModelを再整形するだけの純粋関数、計算ロジックなし）
- [x] Renderer Interface — `src/presentation/presentationRenderer.ts`
      （`PresentationRenderer<T>`。実装はReact/Fableどちらも未着手、インターフェースのみ）
- [x] Renderer Snapshot — `scripts/explore-roi.ts --presentation-json` +
      `docs/ai/presentation.sample.json`（実行して得た実データを保存した例）
- [x] Theme/Layout Tokens — `src/presentation/tokens/themeTokens.ts` /
      `layoutTokens.ts`（spacing/radius/typography/color/elevation/breakpoint/grid、
      CSSやアニメーションは含めない）
- [x] Presentation Validation — `src/presentation/presentationValidation.ts`
      （JSONシリアライズ可能性・DBエンティティ混入検知・決定性テストヘルパー）
- [x] Snapshot Tests — `src/presentation/presentation.test.ts`（9件）

### Phase 2.6 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/presentation/presentationModel.ts` | 表示契約の型定義 |
| `src/presentation/presentationBuilder.ts` | ViewModel→Presentationの再整形（純粋関数） |
| `src/presentation/presentationRenderer.ts` | `PresentationRenderer<T>` インターフェース |
| `src/presentation/tokens/themeTokens.ts` | spacing/radius/typography/color等のトークン |
| `src/presentation/tokens/layoutTokens.ts` | breakpoint/card size/grid/gapのトークン |
| `src/presentation/presentationValidation.ts` | シリアライズ可能性・DBエンティティ混入検知 |
| `src/presentation/presentation.test.ts` | スナップショットテスト |
| `scripts/explore-roi.ts` | `--presentation-json` 追加 |
| `docs/ai/presentation.sample.json` | 実行して得た出力例 |
| `docs/ai/07-PRESENTATION-LAYER.md` | アーキテクチャ・Component Contract・Fable統合手順 |

### レディネス状況

| 項目 | 状態 | 備考 |
|---|---|---|
| Presentation Ready | ✅ done | `src/presentation/` 一式、`--presentation-json` |
| Renderer Ready | 🟡 partial | `OpportunityPresentation`/`LifecyclePresentation`の境界確認PoC（TypeScript stand-in）のみ実装済み。React向けの実装、および他コンポーネント（RuleCard/Warning/ResearchSummary）はまだ無い |
| Fable Ready | 🟡 partial | データ契約・境界確認は2種類のPoCで実証済み。本物のFable（F#/.NET）ツールチェインは未導入（`docs/ai/08-FABLE-IMPLEMENTATION-PLAN.md`）。`docs/ai/06-FABLE-READINESS.md` の残条件（複数カード実運用、Phase 3完了、実装コスト面の必要性確認）は未達 |

### Fable境界PoC進捗（Phase 2.6拡張、TypeScript stand-in）

| コンポーネント | 状態 | 実装ファイル |
|---|---|---|
| Opportunity Card | ✅ done | `src/renderers/fable/fableOpportunityRenderer.ts` |
| Lifecycle Timeline | ✅ done | `src/renderers/fable/fableLifecycleRenderer.ts` |
| Rule Card | 未着手 | — |
| Warning Badge | 未着手 | — |
| Research Summary / Daily Report | 未着手 | — |

いずれも実際のFable（F#/.NET）コンパイラは使っていない。本物の導入条件は
`docs/ai/08-FABLE-IMPLEMENTATION-PLAN.md`を参照。

### Phase 2.6後の残タスク

- Presentation Layerを実際に描画するReact向けレンダラー実装がまだ無い
  （Fable向けはTypeScript stand-in PoCが2つ完了、本物のFableはまだ）
- 複数カード・Daily Report相当の実運用を経ていない（Phase 5待ち）
- デザイントークンはプレースホルダー値のまま。実配色・実機確認は未実施

## Phase 3: Rule Lifecycle — `in progress`

**着手前提: 満たした（2026-07-06）。** 通常pnpm環境で `pnpm typecheck` / `pnpm test`
（192/192）/ `pnpm explore:roi -- --json|--view-json|--presentation-json` の正式合格を
確認済み（`docs/ai/05-VERIFICATION.md` 参照）。Claude Code実行環境の403制約下で追加作業
する場合は `pnpm run verify:strip-types` / `pnpm run verify:roi-smoke` で代替検証し、
その旨を完了報告に明記する。

目的: Phase 1の型・状態遷移関数を実際の運用（`docs/rule-candidates.md` の手動運用）に接続する。

- [x] Candidate / Backtest / Forward / Review / Approved / Production / Deprecated / Archive の永続化 —
      **JSON方式を採用**（`data/research-rules.json`、既存の`data/research-hypotheses.json`と
      同じ「git管理下のJSONレジストリ」パターン）。SQLite DBには一切書き込まない
      （CLAUDE.mdの絶対禁止事項「DBへのINSERT/UPDATE/DELETE/DROP禁止」を素直に守るため、
      新規テーブルも作らない選択をした）
- [x] 状態遷移制約の適用箇所 — `scripts/manage-research-rules.ts`（`pnpm manage:research-rules`）の
      `add`/`transition`サブコマンドから、`src/domain/researchRuleStore.ts`の
      `applyRuleTransition`を必ず経由する。UI/他CLIからの呼び出しはまだ無い（最小実装のため）
- [x] Production直行禁止をコード上で強制する経路の実装 — `applyRuleTransition`が
      `canTransitionRuleStatus`で許可されない遷移（candidate/backtest/forward/review→production
      の直行を含む）を拒否し、CLIはexit 1で終了する。手動E2E確認済み（下記実装ファイル参照）
- [x] `docs/rule-candidates.md` の `candidate/watch/reject/adopted/reverted` との対応関係を整理 —
      **マッピング表を作成**（`docs/ai/09-RULE-CANDIDATE-MIGRATION.md`）。既存候補の一括移行は
      していない（1件ずつ人が判断する運用のまま）。特に`adopted`は自動で`production`にしない
      （Forward Test未実施のため）ことを明記

### Phase 3 実装ファイル（最小実装分）

| ファイル | 内容 |
|---|---|
| `src/domain/researchRuleStore.ts` | `createResearchRule`（常にcandidateで作成、`title`任意）, `addRule`（重複ruleId拒否）, `applyRuleTransition`（状態遷移バリデーション、production行きはForwardTestResult必須） |
| `src/domain/researchRuleStore.test.ts` | 10件のテスト |
| `scripts/manage-research-rules.ts` | `data/research-rules.json`のみを読み書きするCLI（`list [--status]`/`add [--title] [--dry-run]`/`transition [--dry-run]`） |
| `scripts/verify-research-rules-dry-run.mjs` | `--dry-run`のファイル不変更・遷移拒否・migrationドキュメントの用語網羅を確認するnpm非依存E2Eチェック |
| `docs/ai/09-RULE-CANDIDATE-MIGRATION.md` | status mapping・移行してよい/いけない条件・AI単独判断禁止・移行手順・rollback |

### Phase 3 残タスク（最小実装の次）

- `docs/rule-candidates.md`の候補を実際に`data/research-rules.json`へ1件ずつ移行する
  （`docs/ai/09-RULE-CANDIDATE-MIGRATION.md`の手順に従う。まだ0件）
- `list`以外の読み取り専用レポート（例: production段階のルール一覧、warnings付き表示）
- Rule Timeline / Rule Comparison など Research Engine機能一覧（`docs/ai/03-RESEARCH.md`）との接続
- 現状`data/research-rules.json`はまだ空（実際のルール登録はユーザー判断で行う。AI単独判断禁止のため、
  実データは今回投入していない）

## Phase 4: Drift Detection — `in progress`（最小実装）

目的: `RuleEvaluationResult`（Phase 1〜2）2件（baseline期間 / recent期間）を比較し、
ROI/的中率の悪化を検知する最小基盤を作る。

既存の `src/domain/rollingDrift.ts`（decision_history行を月別に集計し、期待的中率との
calibration乖離で`alert: "ok"|"watch"|"drift"`を出す、`report:calibration`向けの既存ロジック）
とは別軸として追加した。置き換えではなく、Research Foundation型（`RuleEvaluationResult`）に
載せたbaseline/recent 2期間比較版。

- [x] baseline/recent 2期間比較の型 — `src/domain/researchDrift.ts`
      （`DriftWindow`, `DriftComparison`, `DriftSignal`, `DriftDetectionResult`, `DriftSeverity`）
- [x] ROI悪化検知（最小しきい値） — `detectRoiDrift`（`roiDelta`ベースのwatch/warning/critical
      3段階 + 損益分岐点割れの`roiCollapse`検知）。しきい値は暫定値（`DRIFT_ROI_DELTA_*`,
      `BREAKEVEN_ROI`）で、実運用実績が増えたら見直す前提
- [x] サンプルサイズ不足時の安全装置 — recentサンプルが0なら`severity=unknown`、
      `MIN_DRIFT_SAMPLE_SIZE`(30)未満なら`severity=warning`とし、信頼できないROI比較を
      「悪化なし」と誤判定しないようにした
- [x] Forward未通過ルールをProduction崩壊扱いしない安全装置 — `buildDriftDetectionResult`が
      `recentEvaluation.isForwardTested`を見て、悪化の事実（severity）自体は変えずに
      「production崩壊」と断定する文言を避け、candidate/backtest段階の悪化である旨をwarningsに
      明記する
- [x] read-only CLI — `scripts/detect-research-drift.ts`（`pnpm detect:drift`）。
      `--baseline-from/--baseline-to/--recent-from/--recent-to/--rule-id/--condition/--json`。
      DBへの書き込みは一切行わない（`explore-roi.ts`と同じ read-only 接続）
- [ ] 直近30/60/90日 vs 長期比較のプリセット（現状は`--baseline-*`/`--recent-*`を都度指定する
      adhoc運用のみ）
- [ ] 複数ルール一括判定（`data/research-rules.json`の**読み取り**連携はPhase 4.1で追加済み。
      一括判定・複数ルールの並列実行は依然未着手）
- [ ] 警告出力の通知連携（LINE/Web Push等への接続は未着手、Phase 5以降で判断）
- [x] ViewModel/Presentation層（`DriftSignalViewModel`等）— Phase 4.1で追加（下記参照）

### Phase 4 実装ファイル（最小実装分）

| ファイル | 内容 |
|---|---|
| `src/domain/researchDrift.ts` | `DriftWindow`, `DriftComparison`, `DriftSignal`, `DriftSeverity`, `DriftDetectionResult`, `compareEvaluationWindows`, `detectRoiDrift`, `buildDriftDetectionResult` |
| `src/domain/researchDrift.test.ts` | 12件のテスト（サンプル不足/悪化度合い別severity/Forward未通過時の安全装置/window重複警告など） |
| `scripts/detect-research-drift.ts` | baseline/recent 2期間のROI Explorer相当をDriftDetectionResultとして出力するread-only CLI |
| `scripts/verify-drift-smoke.mjs` | 依存なしE2Eスモーク（CLIのJSON必須フィールド・severity判定・DB非書き込みを確認） |

### Phase 4 残タスク・未決定事項（TODO）

- `DRIFT_ROI_DELTA_CRITICAL/WARNING/WATCH`と`MIN_DRIFT_SAMPLE_SIZE`は暫定値。実運用実績を
  見ながら閾値を見直す（`MIN_PRODUCTION_SAMPLE_SIZE`等と同様、レビュー前提の値）
- 直近30/60/90日など期間プリセットの追加、複数ルール一括判定、`research-rules.json`との連携は未着手
- ViewModel/Presentation層（`DriftSignalViewModel`, `DriftDetectionViewModel`, `DriftPresentation`）
  はまだ無い。UI実装・Fable/React実装は今回のスコープ外
- 通常pnpm環境での`pnpm typecheck`/`pnpm test`/`pnpm detect:drift -- --json`の正式実行は
  未確認（`docs/ai/05-VERIFICATION.md`参照）

## Phase 4.1: Drift Operations（ViewModel/Presentation/ルールメタデータ） — `done`（最小実装）

目的: Phase 4のDrift Detectionを単発CLIから研究運用に近づける。ROI計算・severity判定
ロジックは一切変更せず、表示契約（ViewModel/Presentation）と`data/research-rules.json`
の読み取り連携だけを追加する。本物のFable導入は引き続き行っていない。

- [x] Drift ViewModel — `src/view-models/driftViewModel.ts`
      （`DriftSignalViewModel`, `DriftDetectionViewModel`, `DriftSummaryViewModel`）
- [x] Drift ViewModel adapter — `src/view-models/driftViewModel.adapters.ts`
      （`buildDriftDetectionViewModel`, `buildDriftSummaryViewModel`。`DriftDetectionResult`の
      severity/roi/signalsを再計算せず、そのまま表示用に整形するだけ）
- [x] Drift Presentation — `src/presentation/driftPresentationModel.ts`
      （`DriftDetectionPresentation`, `DriftSignalPresentation`, `DriftSummaryPresentation`。
      既存`presentationModel.ts`と同じくrenderer非依存・JSONシリアライズ可能・domain型を
      importしない独立した文字列リテラル型）
- [x] Drift Presentation builder — `src/presentation/driftPresentationBuilder.ts`
      （`buildDriftPresentation`, `buildDriftSummaryPresentation`。追加した唯一の派生値は
      severity→表示ラベルの静的マップ`severityLabel`で、severity判定自体は変更しない）
- [x] CLI `--presentation-json` — `scripts/detect-research-drift.ts`に追加。既存`--json`
      （`DriftDetectionResult`そのまま）は無変更
- [x] `data/research-rules.json`の読み取り専用連携 — `--rule-id`が一致するルールを
      read-onlyで探し、title/statusを表示情報に添える（`loadRuleMeta`。ファイルが無い/
      パース失敗/未一致なら従来通りadhoc ruleとして動く。書き込みは一切行わない）
- [x] production以外のルールをproduction崩壊と断定しない安全装置 — ruleMeta.statusが
      `"production"`以外の場合、`buildDriftDetectionViewModel`が
      「この drift を confirmed production incident として扱わない」旨の警告を1件追加する
      （AI単独判断禁止・ブラックボックス禁止の原則に沿う表示レベルの注記であり、
      severity/signalsの判定そのものは変えない）

### Phase 4.1 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/view-models/driftViewModel.ts` | `DriftSignalViewModel`, `DriftDetectionViewModel`, `DriftSummaryViewModel` |
| `src/view-models/driftViewModel.adapters.ts` | `buildDriftDetectionViewModel`, `buildDriftSummaryViewModel` |
| `src/view-models/driftViewModel.adapters.test.ts` | 8件のテスト（数値/signals非再計算、ruleMeta有無、production以外の注記付与/非付与） |
| `src/presentation/driftPresentationModel.ts` | `DriftSeverityPresentation`, `DriftSignalPresentation`, `DriftDetectionPresentation`, `DriftSummaryPresentation` |
| `src/presentation/driftPresentationBuilder.ts` | `buildDriftPresentation`, `buildDriftSummaryPresentation` |
| `src/presentation/driftPresentation.test.ts` | スナップショット・キー混入検知・シリアライズ可能性・決定性のテスト（既存`presentation.test.ts`と同パターン） |
| `scripts/detect-research-drift.ts` | `--presentation-json`追加、`--rule-id`のread-only `research-rules.json`連携（`loadRuleMeta`） |
| `scripts/verify-drift-smoke.mjs` | `--presentation-json`必須フィールド・`--rule-id`連携・`research-rules.json`フィクスチャ非書き込みのシナリオを追加 |

### Phase 4.1 残タスク・未決定事項（TODO）

- `DriftSummaryViewModel`/`DriftSummaryPresentation`はまだCLIから単体で使われていない
  （複数drift一覧はPhase 5 Daily Report接続時に使う想定の下地のみ）
- React向けdriftコンポーネントの実装はまだ無い（`src/renderers/fable/`と同様、本物のFableは
  依然未導入）
- 複数ルール一括判定（`data/research-rules.json`のルールを全件走査してdrift判定する機能）は
  Phase 4に引き続き未着手。今回追加したのは単一`--rule-id`のメタデータ読み取りのみ
- 通常pnpm環境での`pnpm typecheck`/`pnpm test`/`pnpm detect:drift -- --presentation-json`の
  正式実行結果は`docs/ai/05-VERIFICATION.md`を参照

## Phase 5: Daily Research Report — `in progress`（最小実装）

目的: ROI Explorer（Phase 2）とDrift Detection（Phase 4/4.1）の結果を、1日1回の
研究レポートとして要約する最小基盤を作る。**買い推奨・Production昇格の判断ではない。**
詳細は`docs/ai/11-DAILY-RESEARCH-REPORT.md`を参照。

- [x] Daily Report Domain型 — `src/domain/dailyResearchReport.ts`
      （`DailyResearchReport`, `DailyResearchRoiSummary`, `DailyResearchDriftSummary`,
      `DailyResearchReportFinding`, `DailyResearchReportWarning`）
- [x] Daily Report Builder — 同ファイルの`buildDailyResearchReport`
      （`buildDailyResearchRoiSummary`/`buildDailyResearchDriftSummary`はROI/Drift結果を
      再計算せず要約するだけ。`buildDailyResearchFindings`/`buildDailyResearchNextActions`は
      既存の`MIN_PRODUCTION_SAMPLE_SIZE`/`isForwardTested`/`severity`をそのまま使い、
      新しい判定基準は作らない。文言は「要検証」「見送り」等の研究用語に留め、
      「買い推奨」「採用確定」は使わない）
- [x] read-only CLI — `scripts/daily-research-report.ts`（`pnpm daily:research-report`）。
      `--date/--json/--presentation-json`。ROI窓は`--date`までの全期間、Drift窓は
      直近30日 vs それ以前の全期間（暫定値）。DBへの書き込みは一切行わない
- [x] Presentation契約 — `src/presentation/dailyResearchReportPresentation.ts` +
      `dailyResearchReportBuilder.ts`。`driftSummary`は既存の`DriftDetectionPresentation`
      （Phase 4.1）をそのまま再利用し、severityLabel等を重複実装しない
- [ ] 新仮説（Phase 2の出力から）の取り込みは未着手。現状はROI Explorerの単一評価のみ
- [x] Forward結果の複数ルール一覧 — Phase 5.1で`--rules-file`による複数ルール横断が可能に
      （下記「Phase 5.1」参照）
- [ ] 今日のOpportunity（`OpportunityPresentation`との統合）は未着手
- [ ] `docs/rule-candidates.md`の候補一覧との接続は未着手

### Phase 5 実装ファイル（最小実装分）

| ファイル | 内容 |
|---|---|
| `src/domain/dailyResearchReport.ts` | `DailyResearchReport`等の型、`buildDailyResearchReport`とその内部ビルダー |
| `src/domain/dailyResearchReport.test.ts` | 11件のテスト（要約が数値/severityを再計算しない、Forward未通過/サンプル不足時の文言、dataQualityNotesの抽出等） |
| `src/presentation/dailyResearchReportPresentation.ts` | `DailyResearchReportPresentation`等のPresentation型 |
| `src/presentation/dailyResearchReportBuilder.ts` | `buildDailyResearchReportPresentation`（既存`buildDriftPresentation`を再利用） |
| `src/presentation/dailyResearchReportPresentation.test.ts` | 9件のテスト（キー混入検知・シリアライズ可能性・決定性・研究用語の非断定表現） |
| `scripts/daily-research-report.ts` | Daily Research Report read-only CLI |

### Phase 5 残タスク・未決定事項（TODO）

- Drift窓のデフォルト（直近30日 vs それ以前の全期間）は暫定値。実運用実績を見ながら見直す
  （`docs/ai/10-DRIFT-OPERATIONS.md`の閾値注意と同様の扱い）
- `OpportunityPresentation`・`RuleCardPresentation`との統合、`docs/rule-candidates.md`との
  接続はまだ判断していない
- 通常pnpm環境での`pnpm typecheck`/`pnpm test`/`pnpm daily:research-report -- --json|--presentation-json`
  の正式実行結果は`docs/ai/05-VERIFICATION.md`を参照

## Phase 5.1: Multiple Rule Daily Research Report — `done`（最小実装）

目的: Phase 5の単一adhocレポートを、`data/research-rules.json`に登録された複数
`ResearchRule`を横断して要約できる研究レポートへ拡張する。ROI/Drift計算のロジックは
一切変更せず、既存の単一adhocレポート（`--rules-file`省略時）も無変更のまま残す。
詳細は`docs/ai/11-DAILY-RESEARCH-REPORT.md`を参照。

- [x] 複数ルール向けDomain型 — `src/domain/dailyResearchReport.ts`に追加
      （`DailyResearchRuleReport`, `DailyResearchReportAggregate`,
      `DailyResearchReportAggregateSummary`）。既存の`DailyResearchReport`（単一adhoc）は無変更
- [x] 複数ルールBuilder — 同ファイルの`buildDailyResearchRuleReport`/
      `buildMultiRuleDailyResearchReport`。ROI/severityは再計算せず、既存の
      `buildDailyResearchRoiSummary`/`buildDailyResearchDriftSummary`/
      `buildDailyResearchFindings`/`buildDailyResearchNextActions`をルールごとに再利用するだけ。
      critical/warning(+watch)/unknownのdrift件数、Forward未通過件数、非production状態件数を
      集計するが、集計結果から自動採用・買い推奨は行わない
- [x] Production未満のルールを明示する安全装置 — `buildRuleStatusFinding`が、登録statusが
      `"production"`以外のルールに対して「このルールはProductionに達しておらず、
      この評価をProduction運用実績として扱ってはいけない」旨のfindingを必ず追加する
- [x] ルール固有条件が無いことの明示 — `data/research-rules.json`の`ResearchRule`はまだ
      ルール固有の絞り込み条件を持たないため、各ルールのROI/Driftは共通のdecision_history
      集計をruleId/title/statusでラベル付けしたものに過ぎない。この事実を`warnings`に
      必ず1件残す（ブラックボックス禁止の原則）
- [x] `research-rules.json`のread-only読み取り — `scripts/daily-research-report.ts`に
      `--rules-file <path>`を追加。read-only（`existsSync`+`readFileSync`のみ、
      `writeFileSync`は一切呼ばない）。`archived`ステータスのルールは初期状態で除外。
      ファイルが無い/パースできない場合は警告を出して単一adhocレポートへフォールバックする
      （`--rules-file`を指定しなければ従来通り単一adhocレポートのまま、Phase 5から無変更）
- [x] Presentation拡張 — `src/presentation/dailyResearchReportPresentation.ts`/
      `dailyResearchReportBuilder.ts`に`DailyResearchRulePresentation`/
      `DailyResearchReportAggregatePresentation`を追加。`driftSummary`は既存の
      `DriftDetectionPresentation`をそのまま再利用し、severityLabel等を重複実装しない
- [ ] `--include-archived`（archivedルールを含める）は未実装。Phase 5.3以降で検討
- [x] ルール固有の絞り込み条件（venue/raceNo/decisionのequalsのみ）を`ResearchRule`が
      持てるようにするスキーマ拡張 — Phase 5.2で対応（下記「Phase 5.2」参照）

### Phase 5.1 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/dailyResearchReport.ts` | （既存ファイルへ追加）`DailyResearchRuleReport`, `DailyResearchReportAggregate`, `DailyResearchReportAggregateSummary`, `buildDailyResearchRuleReport`, `buildMultiRuleDailyResearchReport` |
| `src/domain/dailyResearchReportMultiRule.test.ts` | 13件のテスト（ラベル付けのみで数値非変更、Production未達finding、archived許容、件数集計、overallNextActionsの非断定表現等） |
| `src/presentation/dailyResearchReportPresentation.ts` | （既存ファイルへ追加）`DailyResearchRulePresentation`, `DailyResearchReportAggregateSummaryPresentation`, `DailyResearchReportAggregatePresentation` |
| `src/presentation/dailyResearchReportBuilder.ts` | （既存ファイルへ追加）`buildDailyResearchRulePresentation`, `buildDailyResearchReportAggregatePresentation` |
| `src/presentation/dailyResearchReportAggregatePresentation.test.ts` | 11件のテスト（キー混入検知・シリアライズ可能性・決定性・非production状態の表示） |
| `scripts/daily-research-report.ts` | `--rules-file <path>`追加（read-only、archived除外、フォールバック動作） |

### Phase 5.1 残タスク・未決定事項（TODO）

- 各ルールのROI/Driftは「共通集計のラベル付け」であり、ルール固有条件での絞り込み
  評価ではなかった → **Phase 5.2で対応**（下記参照）
- `--include-archived`は未実装（docsに残すだけの将来対応）
- 複数ルールレポートの`reports/*`への自動出力・保存、通知連携は未着手
- `DailyResearchReportAggregate`と`ResearchSummaryPresentation`（既存のRule Card一覧）との
  統合方針は未判断
- 通常pnpm環境での`pnpm typecheck`/`pnpm test`/
  `pnpm daily:research-report -- --rules-file <path> --json|--presentation-json`の
  正式実行結果は`docs/ai/05-VERIFICATION.md`を参照

## Phase 5.2: Rule-Specific Daily Report Evaluation — `done`（最小実装）

目的: Phase 5.1で複数`ResearchRule`をDaily Reportに並べられるようにしたが、各ルールの
ROI/Driftはまだ「共通集計のラベル付け」だった。Phase 5.2では、`ResearchRule`ごとの
評価条件をread-onlyで読み取り、可能な範囲でルール固有条件に基づくROI/Drift評価を
行えるようにする。ROI/Drift計算のロジック自体は変更せず、既存のROI Explorer条件
フィルタ（`applyCondition`）を再利用するだけに留める。詳細は
`docs/ai/11-DAILY-RESEARCH-REPORT.md`を参照。

- [x] `ResearchRule`へ評価条件を追加（後方互換） — `src/domain/researchRule.ts`に
      `ResearchRuleEvaluationCondition`（`key`/`operator`（"equals"のみ）/`value`）と
      `ResearchRule.evaluationConditions?`を追加。省略可能なため既存`research-rules.json`
      はそのまま読み込める
- [x] Rule condition evaluation helper — `src/domain/researchRuleConditions.ts`
      （`validateResearchRuleConditions`, `applyResearchRuleConditions`,
      `describeResearchRuleConditions`, `determineEvaluationScope`,
      `hasRuleSpecificConditions`）。allowlist方式（対応operatorは"equals"のみ、
      対応keyは既存の`SUPPORTED_CONDITION_KEYS`＝venue/raceNo/decisionのみ）。
      条件フィルタそのものは既存の`applyCondition`（ROI Explorerと共通）をそのまま
      再利用し、重複実装しない。unsupported operator・unknown keyはthrowせずwarningへ
      積んで無視する（安全側に倒す）。SQL文字列の生成・任意コード実行経路は一切無い
- [x] Daily Reportをrule固有評価へ対応 — `scripts/daily-research-report.ts`の
      `buildRuleInput`が、各ルールの`evaluationConditions`をROI窓・baseline窓・recent窓の
      decision_history行に適用してから`buildRuleEvaluationResult`/
      `buildDriftDetectionResult`を計算する。条件が無い/全て無効なら
      `applyResearchRuleConditions`がrowsをそのまま返すため、結果的に共通集計と
      同じ評価になる（新しい分岐ロジックを追加していない）
- [x] Drift評価もrule固有条件に寄せる — baseline/recent両方の窓に同じrule条件を適用する。
      recent sampleSize不足時のseverity（`unknown`扱い）は既存の`researchDrift.ts`の
      判定（`MIN_DRIFT_SAMPLE_SIZE`）をそのまま使い、severityの再判定はしていない
- [x] Domain/Presentation拡張 — `DailyResearchRuleReport`/`DailyResearchRulePresentation`に
      `isRuleSpecificEvaluation`/`evaluationScope`/`conditionSummary`/`conditionWarnings`を
      追加。`evaluationScope`は`"rule-specific"`/`"shared-fallback"`/
      `"invalid-condition-fallback"`の3値。既存の単一adhoc出力（`DailyResearchReport`）は
      無変更のまま
- [x] `not-rule-specific-filter`警告の文言を分岐 — `evaluationScope`が`"rule-specific"`
      以外の場合のみ、共通集計であることを明記する警告を残す。`"shared-fallback"`
      （条件未指定）と`"invalid-condition-fallback"`（条件はあるが全て無効）とで
      理由文言を変える

### Phase 5.2 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchRule.ts` | （既存ファイルへ追加）`ResearchRuleConditionOperator`, `ResearchRuleEvaluationCondition`, `ResearchRule.evaluationConditions?` |
| `src/domain/researchRuleConditions.ts` | `validateResearchRuleConditions`, `applyResearchRuleConditions`, `describeResearchRuleConditions`, `determineEvaluationScope`, `hasRuleSpecificConditions`, `ResearchRuleEvaluationScope` |
| `src/domain/researchRuleConditions.test.ts` | 12件のテスト（unsupported operator/unknown keyのwarning化、AND結合、非破壊、fallback時の素通し） |
| `src/domain/dailyResearchReport.ts` | （既存ファイルへ追加）`DailyResearchRuleReport`/`BuildDailyResearchRuleReportInput`に`evaluationScope`/`conditionSummary`/`conditionWarnings`/`isRuleSpecificEvaluation`を追加 |
| `src/domain/dailyResearchReportEvaluationScope.test.ts` | 5件のテスト（scope省略時の後方互換、rule-specific/shared-fallback/invalid-condition-fallbackの警告文言の違い） |
| `src/presentation/dailyResearchReportPresentation.ts` | （既存ファイルへ追加）`DailyResearchEvaluationScopePresentation`、`DailyResearchRulePresentation`拡張 |
| `src/presentation/dailyResearchReportBuilder.ts` | （既存ファイルへ追加）`buildDailyResearchRulePresentation`が新フィールドをそのまま反映 |
| `src/presentation/dailyResearchReportEvaluationScopePresentation.test.ts` | 4件のテスト（rule-specific/shared-fallback/invalid-condition-fallbackの表示・シリアライズ可能性） |
| `src/presentation/dailyResearchReportAggregatePresentation.test.ts` | （既存ファイル更新）Phase 5.2の新フィールドをキー混入検知の許可リストへ追加 |
| `scripts/daily-research-report.ts` | `buildRuleInput`でrule-specific評価を組み立て、`--json`/`--presentation-json`双方に反映 |

### Phase 5.2 残タスク・未決定事項（TODO）

- `evaluationConditions`は依然としてequals・venue/raceNo/decisionのみ。範囲条件・OR条件・
  正規表現・任意JS式は意図的に未対応（`docs/ai/11-DAILY-RESEARCH-REPORT.md`参照）
- `--include-archived`は引き続き未実装
- 複数ルールレポートの`reports/*`への自動出力・保存、通知連携は未着手
- `OpportunityPresentation`・`RuleCardPresentation`との統合、`docs/rule-candidates.md`との
  接続方針は未判断
- Drift比較窓のデフォルト（直近30日 vs それ以前の全期間）は暫定値のまま（Phase 5から継続）
- 通常pnpm環境での`pnpm typecheck`/`pnpm test`/
  `pnpm daily:research-report -- --rules-file <path> --json|--presentation-json`の
  正式実行結果は`docs/ai/05-VERIFICATION.md`を参照

## 進行ルール

- 各Phaseの開始前に、このファイルの状態を `in progress` に更新する
- Phase内でも一度に全項目を実装しない。小さなコミットに分ける
- 次のセッションへの引き継ぎは、このファイルの `未接続・未決定事項` に残す
