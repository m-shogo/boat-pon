# Verification Checklist

Boat Pon の研究フェーズ（Phase 1〜）で「検証した」と言うために何を確認すべきかをまとめた
チェックリストです。特にPhase 3（Rule Lifecycle実装、永続化・状態遷移の本番接続）に進む前は
このファイルの「Phase 3着手前の必須コマンド」を必ず満たしてください。

## Local verification

通常のpnpm環境（`pnpm install` が完了する環境）で実行する、日常的な検証手順です。

```sh
pnpm install
pnpm typecheck          # tsc -b。型エラーが無いことを確認
pnpm test               # node --test --import tsx src/domain/*.test.ts。全件passを確認
pnpm build               # typecheck + vite build。ビルドが通ることを確認
pnpm verify              # typecheck + test + build をまとめて実行
```

Research Engine（Phase 1〜）に関わる変更をした場合は、追加で以下も実行する。

```sh
pnpm explore:roi -- --json                      # ROI Explorer CLIが正常終了しJSONが妥当な形か確認
pnpm explore:roi -- --condition venue=桐生 --json  # 条件フィルタが機能するか確認（実DBの会場名を使う）
```

Drift Detection（Phase 4〜）に関わる変更をした場合は、追加で以下も実行する。

```sh
pnpm detect:drift -- --baseline-from <開始日> --baseline-to <終了日> \
                     --recent-from <開始日> --recent-to <終了日> --json
# DriftDetectionResultが正常終了しJSONが妥当な形か確認（severity/signals/warningsを含む）
```

## CI verification

このリポジトリに現状専用のCI設定は無い（`.github/workflows` を都度確認すること）。
CIが無い間は、PR作成前に手元で以下を実行し、結果をPR説明に記載する。

```sh
pnpm verify:full   # verify + db:health + validate:data + monitor:live + gitleaks
```

CIを新設する場合は、`pnpm typecheck` / `pnpm test` を最低ラインとし、`data/` や実DBへの
書き込みを伴うコマンド（`monitor:live` 等）はCIでは実行しない設計にする。

## Manual smoke test

自動テストで表現しにくい「実際に動くか」を目視確認する。

- `pnpm explore:roi -- --from <開始日> --to <終了日> --json` を実DBに対して実行し、
  `sampleSize` / `roi` / `warnings` が想定と大きく乖離していないか目視確認する
- `--condition` に実在しない会場名や不正形式（`=`が無い等）を渡し、エラー/warningの挙動を確認する
- DBファイルが無い状態（`BOAT_PON_DB_PATH` を存在しないパスに向ける）でも例外で落ちず、
  空の評価結果とwarningsで正常終了することを確認する

## Known blocked environment

**Claude Code実行環境（このセッションのようなサンドボックス）では `pnpm install` が
完了しないことを確認済み。**

- 症状: `registry.npmjs.org` へのリクエストが `403 Forbidden`（レスポンスヘッダ
  `x-deny-reason: host_not_allowed`）を返す。パッケージのメタデータ取得ですら常時失敗し、
  tarball取得も断続的に失敗する（失敗するパッケージが実行ごとに変わる）
- 確認方法: 複数回・複数パッケージでリトライしても収束せず、`npm install -g <pkg>` でも
  同様に失敗することを確認済み
- 対応方針: **この環境ではこれ以上 `pnpm install` を再試行しない。** 組織のネットワークポリシー
  による意図的な遮断であり、クライアント側の対応では解消しない
- 代替検証: 下記の「npm依存なしの軽量検証コマンド」を使う

### npm依存なしの軽量検証コマンド

`node_modules` が無くても、Node標準機能だけで動く検証スクリプトを用意している。

```sh
pnpm run verify:strip-types   # src/domain の研究系モジュール（外部npm依存ゼロ）をnode --experimental-strip-typesで実行
pnpm run verify:roi-smoke     # explore-roi.ts をフィクスチャSQLite DBに対して実行し、出力形状とROI計算を検証
pnpm run verify:research-rules-dry-run  # manage-research-rules.ts の --dry-run 安全性とmigrationドキュメントの網羅性を確認
pnpm run verify:drift-smoke   # detect-research-drift.ts をフィクスチャSQLite DBに対して実行し、出力形状・severity判定・DB非書き込みを確認
```

注意点:

- どちらも `scripts/verify-*.mjs` 自体はNode標準の `fs`/`path`/`os`/`child_process`/`node:sqlite`
  のみを使用し、`node_modules` を必要としない
- 対象は `src/domain/research*.ts` 系（`backtest.ts`/`types.ts`含む）に限定している。他の
  `src/domain/*.ts`（`cheerio` 等の実npm依存を持つパーサ類）はこの方式では検証できない —
  それらは通常の `pnpm test` でのみ検証可能
- **`pnpm typecheck` / `pnpm test` の代替にはならない。** 型チェックは一切行っておらず、
  カバー範囲もPhase 1/2の研究系モジュールのみ

## Phase 3着手前の必須コマンド

Rule永続化・状態遷移の本番接続（Phase 3）に進む前に、通常のpnpm環境で以下を実行し、
すべて正式合格していることを確認する。

```sh
pnpm typecheck
pnpm test
pnpm explore:roi -- --json
```

この環境（`pnpm install`不可）で作業を続ける場合は、代わりに以下を実行し、
その旨を完了報告に明記する。

```sh
pnpm run verify:strip-types
pnpm run verify:roi-smoke
```

## Formal verification attempts log

正式コマンド（`pnpm install`/`pnpm typecheck`/`pnpm test`/`pnpm explore:roi`）を
実際に試みた記録。次にこの環境で作業する人が「また同じ確認をやり直す」ことを
避けるための履歴。

### 2026-07-03: Phase 1〜2.6 + Fable境界PoC 正式検証の試行

- `pnpm install` を3回リトライ（`registry.npmjs.org` へのメタデータ/tarball取得が
  毎回別パッケージで403 `host_not_allowed`）。非一時的な遮断を再確認、以後リトライせず
- `pnpm typecheck` / `pnpm test` / `pnpm explore:roi -- --json|--view-json|--presentation-json`
  は`node_modules`が完成しないため未実行
- 代わりに、Phase 1〜2.6・Fable境界PoCで追加した全ファイル（`src/domain/research*.ts`,
  `src/view-models/*`, `src/presentation/*`, `src/renderers/fable/*`, `scripts/explore-roi.ts`）
  を1行ずつ手動監査。`isolatedModules`前提のimport type分離、interface実装の互換性、
  型の絞り込みを確認。`package.json`のscripts（168件）に重複・グロブ不一致なし
- 監査で1件、予防的な修正が必要な箇所を発見・修正:
  `src/presentation/presentationValidation.ts`の`isJsonSerializable`が
  `const type = typeof value` という中間変数を介した型の絞り込みに依存していた。
  実行時の挙動は正しいことを確認済みだが、tscを手元で確認できない状況では
  より確実な直接 `typeof value === "..."` 方式に書き換えた（動作は不変、
  同じテストケースで再確認済み）
- 代替検証（`node --experimental-strip-types`によるscratchpad一時コピー実行）で
  **Phase1〜2.6 + Fable境界PoC 合計 44/44 テストpass**、`--json`/`--view-json`/
  `--presentation-json`いずれも有効なJSONを出力しexit 0を確認
- **結論**: この環境では引き続き正式なpnpm検証ができない。次に通常pnpm環境に
  入った人が最初にやるべきは、上記3コマンド（`pnpm typecheck`/`pnpm test`/
  `pnpm explore:roi`各モード）を実行し、本ログに正式な結果を追記すること

### 2026-07-06: 通常pnpm環境での正式検証（完了）

ユーザーのローカル環境（macOS、Node 24.15.0、pnpm 11.1.2）で実施。結果:

- `pnpm install` — 成功
- `pnpm typecheck`（`tsc -b`） — **成功、型エラーなし**
- `pnpm test` — **192/192 pass**
  （Phase 1〜2.6 + Fable境界PoCで追加した`researchRule`/`researchRuleLifecycle`/
  `researchEvaluation`/`view-models`/`presentation`/`renderers/fable`の全テストを含む）
- `pnpm explore:roi -- --json` / `--view-json` / `--presentation-json` — 初回は
  `unknown option: --` で失敗（pnpm 11.xが`--`セパレータをストリップせず
  スクリプトへそのまま転送するため）。`scripts/explore-roi.ts`の`parseArgs`に
  「`--`単体は無視する」処理を1行追加（`09c9396`）して解消。3モードとも成功を確認

**結論**: 前回セッションの手動型監査は正しかった（`pnpm typecheck`が実際にエラーなしで
通った）。CLI引数パーサーには実バグが1件あり、実pnpm環境で初めて顕在化した
（サンドボックス側の`node --experimental-strip-types`直接実行では`--`セパレータを
経由しないため再現しなかった）。**Phase 3着手条件を満たした。**

### 2026-07-06（続き）: `pnpm manage:research-rules` の実環境検証（完了）

ユーザーのローカル環境（macOS、Node 24.15.0、pnpm 11.1.2）で実施。結果:

- `pnpm typecheck` — **pass**
- `pnpm test` — **202/202 pass**
- `pnpm manage:research-rules -- list` — **pass**
- `pnpm manage:research-rules -- add --rule-id test-candidate --title "Test Candidate" --reason "smoke test"` — **pass**
- `pnpm manage:research-rules -- list --status candidate` — **pass**
- `pnpm run verify:research-rules-dry-run` — **pass**

`data/research-rules.json`はこのスモークテストで生成された未追跡ファイルであり、
確認後に削除済み（本番候補として残していない）。

**結論**: `--title`/`--status`/`--dry-run`を含む`manage-research-rules.ts`一式が
実pnpm/tsx環境で問題なく動作することを確認した。**Phase 3最小実装は実環境で検証済み。**

### 2026-07-06（続き）: main merge前の最終確認

Claude Code実行環境（`pnpm install`不可、既知の403制約）で実施。`pnpm install`は
今回も再試行1回のみ行い（同じ403 `host_not_allowed`を再確認）、以後リトライしていない。

代替検証:

- `pnpm run verify:strip-types` — pass（17/17）
- `pnpm run verify:roi-smoke` — pass（全シナリオ）
- `pnpm run verify:research-rules-dry-run` — pass（全チェック）
- scratchpad一時コピーでの`node --experimental-strip-types --test`実行 — **60/60 pass**
  （`src/domain`のresearch系・`src/view-models`・`src/presentation`・
  `src/renderers/fable`の全テスト）
- `scripts/explore-roi.ts`の`--json`/`--view-json`/`--presentation-json`を
  フィクスチャDBに対して実行 — 3モードとも有効なJSON・exit 0を確認
- `package.json`のscripts（170件）に重複なし

**このセッションでは修正は不要だった**（前回セッションの`verify-*.mjs`拡張子バグ修正
以降、全て green のまま）。`git status --short`は作業前後ともクリーンで、
`reports/*`・`docs/rule-candidates.md`・`data/research-rules.json`には
一切触れていない。

**結論**: このサンドボックスで確認できる範囲は全てpass。ただし`pnpm typecheck`/
`pnpm test`の実行そのものは、2026-07-06の前回エントリ（ユーザーのローカル環境、
202/202 pass）が直近の正式実行結果であり、今回のセッションで新たなコード変更は
無いため、その結果は引き続き有効と判断する。

### 2026-07-06（続き）: Phase 4 Drift Detection 最小実装

`m-shogo/boat-pon` PR #8 のmain merge後、`feature/phase4-drift-detection`ブランチで実施。
Claude Code実行環境（`pnpm install`不可、既知の403制約）のため、正式コマンド
（`pnpm typecheck`/`pnpm test`/`pnpm detect:drift -- --json`）はこのセッションでは未実行。

代替検証:

- `pnpm run verify:strip-types` — pass（**29/29**。内訳: `researchRuleLifecycle.test.ts` 5件、
  `researchEvaluation.test.ts` 12件、新規`researchDrift.test.ts` 12件）
- `pnpm run verify:roi-smoke` — pass（既存の全シナリオ、Drift追加による回帰なし）
- `pnpm run verify:research-rules-dry-run` — pass（既存の全チェック、回帰なし）
- `pnpm run verify:drift-smoke`（新規） — pass（全24チェック）。フィクスチャSQLite DBで
  baseline窓（黒字30件）とrecent窓（赤字30件）を用意し、`scripts/detect-research-drift.ts`
  が期待通り`DriftDetectionResult`のJSON（必須14フィールド）を出力し、`severity: "critical"`
  と`roiCollapse`シグナルを検知すること、DBが無い場合は`severity: "unknown"`で正常終了する
  こと、CLI実行前後でフィクスチャDBファイルのSHA-256ハッシュが完全に一致する（＝一切書き込み
  していない）ことを確認した
- 実装中に2件のバグを発見・修正（いずれもこのセッション内、他ファイルへの影響なし）:
  1. `scripts/detect-research-drift.ts`: `parseArgs()`呼び出しが`const evaluatedAt`の初期化より
     前に実行され、`evaluatedAtDate()`内で`evaluatedAt`を参照した際にTDZ
     (`ReferenceError: Cannot access 'evaluatedAt' before initialization`) が発生。
     `const evaluatedAt = ...`を`parseArgs()`呼び出しより前に移動して解消（過去の
     `verify-*.mjs`拡張子バグと同種のtop-level実行順序の問題）
  2. `scripts/verify-drift-smoke.mjs`: 同様に`const ROWS_PER_WINDOW = 30`をファイル末尾寄りに
     置いていたため、それより前で実行される`buildFixtureDb()`呼び出しからの参照でTDZが発生。
     ファイル先頭（`KNOWN_EXTENSIONS`の直後）へ移動して解消
- `git status --short`は作業前後ともクリーン（新規追加ファイルのみ）。
  `reports/*`・`docs/rule-candidates.md`・`data/research-rules.json`には一切触れていない

**結論**: このサンドボックスで確認できる範囲（domain層のロジック・CLIの入出力・DB非書き込み）
は全てpass。**次に通常pnpm環境に入った人が最初にやるべきこと**: 以下3コマンドを実行し、
本ログに正式な結果を追記する。

```sh
pnpm typecheck
pnpm test
pnpm detect:drift -- --baseline-from 2025-01-01 --baseline-to 2025-12-31 \
                     --recent-from 2026-01-01 --recent-to 2026-07-06 --json
```

### 2026-07-06（続き）: Phase 4 ブランチ再確認・PR準備前の再検証

前回セッションでユーザーのローカル環境から「`detect:drift`/`verify:drift-smoke`が見つからない」
という報告があったが、原因は`feature/phase4-drift-detection`ブランチに正しく乗れていなかった
こと（`main`または別のcheckout状態で検証していた）と判明。このセッションで以下を再確認した。

- `git branch --show-current` — `feature/phase4-drift-detection`
- `git log --oneline -5` — 先頭が`6c9b03d docs: update Phase 4 drift detection progress`、
  以下`742c4b3`/`56dc407`/`813c5e5`と、Phase 4の4コミットが期待通り並んでいることを確認
- `git status --short`（作業前） — 空（`reports/*`・`docs/rule-candidates.md`の差分は
  今回のセッション開始時点で存在せず、restoreは不要だった）
- `package.json`の`grep`で`"detect:drift"`（line 178）・`"verify:drift-smoke"`（line 15）
  両方の存在を確認

Claude Code実行環境（`pnpm install`不可、既知の403制約、既に複数セッションで非一時的と
確認済み）のため、このセッションでも`pnpm install`は再試行していない。そのため
`pnpm typecheck`/`pnpm test`/`pnpm detect:drift -- --json`は**このセッションでは未実行**。
代替として依存なし検証スクリプトを再実行した。

- `pnpm run verify:strip-types` — pass（**29/29**、前回と同じ内訳）
- `pnpm run verify:roi-smoke` — pass（全シナリオ）
- `pnpm run verify:research-rules-dry-run` — pass（全チェック）
- `pnpm run verify:drift-smoke` — pass（全24チェック）
- `git status --short`（作業後） — 空。修正は不要だった（前回セッションのTDZ修正2件以降、
  全てgreenのまま）

**結論**: ブランチの取り違えが原因であり、コード側の問題ではないことを確認した。
`feature/phase4-drift-detection`は正しくpush済み・4コミットとも揃っており、このサンドボックスで
確認できる範囲は全てpass。**Phase 4の正式なmerge可否判断には、通常pnpm環境で
`pnpm typecheck`/`pnpm test`/`pnpm detect:drift -- --json`の実行結果が必要**（未確定）。
`reports/*`・`docs/rule-candidates.md`・`data/research-rules.json`は今回のセッションでも
一切触れていない。

### 2026-07-07: Phase 4 merge後のpost-merge verification（main、完了）

`feature/phase4-drift-detection`がPR #9でmainへmerge済みだったため、mainブランチ
（`git pull origin main`でfast-forward後、`67dbeae3ebd256d84cd8b865e9431d5eebaf4e35`）
上で正式検証を実施した。

- main commit hash: `67dbeae3ebd256d84cd8b865e9431d5eebaf4e35`
- `pnpm typecheck` — **pass**（型エラーなし）
- `pnpm test` — **220/220 pass**
- `pnpm detect:drift -- --baseline-from 2025-01-01 --baseline-to 2025-12-31 --recent-from 2026-01-01 --recent-to 2026-07-06 --json` — **pass**
  （有効なJSON、exit 0。`severity: "none"`、baseline n=2265 / recent n=44）
- `pnpm run verify:strip-types` — **pass**（29/29）
- `pnpm run verify:roi-smoke` — **pass**（全シナリオ）
- `pnpm run verify:research-rules-dry-run` — **pass**（全チェック）
- `pnpm run verify:drift-smoke` — **pass**（severity=critical検知シナリオ含む全チェック）
- 作業前後とも`git status --short`は`reports/*`・`docs/rule-candidates.md`の既存差分
  のみで、それ以外はクリーン。`data/research-rules.json`は生成・残置していない

**結論**: Phase 4（Rule Drift Detection）を含むmainの正式検証が全てpassした。
`claude/boat-pon-platform-design-5s2cvm`・`feature/phase4-drift-detection`とも
`git diff --stat origin/main...<branch>`が空であることを確認済みで、mainは両ブランチの
変更を完全に含む。ブランチ削除はユーザーの明示的な指示があるまで行わない。

### 2026-07-07: Phase 4.1 Drift Operations 実装後の検証（完了）

`feature/phase4-1-drift-operations`ブランチ（mainから分岐）で、Drift ViewModel/
Presentation/`--presentation-json`/`--rule-id`の`research-rules.json`読み取り連携
（Phase 4.1）を追加した後の検証結果。

- `pnpm typecheck` — **pass**（型エラーなし）
- `pnpm test` — **235/235 pass**（Phase 4.1で追加した
  `src/view-models/driftViewModel.adapters.test.ts`（8件）・
  `src/presentation/driftPresentation.test.ts`（7件）を含む）
- `pnpm detect:drift -- --baseline-from 2025-01-01 --baseline-to 2025-12-31 --recent-from 2026-01-01 --recent-to 2026-07-06 --json` — **pass**（`DriftDetectionResult`、既存Phase 4形状のまま変化なし）
- `pnpm detect:drift -- (同条件) --presentation-json` — **pass**（`DriftDetectionPresentation`、
  `severityLabel`/`ruleTitle`/`ruleStatus`を含む新形状。`--rule-id`未指定時は
  `ruleTitle`/`ruleStatus`ともnull）
- `pnpm run verify:strip-types` — **pass**（29/29）
- `pnpm run verify:roi-smoke` — **pass**（全シナリオ）
- `pnpm run verify:research-rules-dry-run` — **pass**（全チェック）
- `pnpm run verify:drift-smoke` — **pass**（`--presentation-json`必須フィールド・
  `--rule-id`によるフィクスチャ`research-rules.json`読み取り・読み取り後もフィクスチャが
  byte-for-byte不変であることの確認シナリオを追加した上で全チェック）
- 手動確認: `BOAT_PON_RULE_STORE_PATH`をスクラッチパッド上のフィクスチャJSONに向けて
  `--rule-id`一致/不一致の両方を実行し、一致時はtitle/status付与＋
  「confirmed production incidentとして扱わない」警告付与、不一致時はadhoc rule
  （`ruleTitle`/`ruleStatus`ともnull）のままであることを確認。実行前後でフィクスチャ
  ファイルの内容が変わっていないことも確認済み
- `git status --short`は作業前後とも`reports/*`・`docs/rule-candidates.md`の既存差分
  のみで、それ以外はクリーン。`data/research-rules.json`は生成・残置していない

**結論**: Phase 4.1（Drift Operations最小実装）の正式検証が全てpassした。
ROI計算・Research Engine・Rule Storeの状態遷移ロジックには一切触れておらず、
表示契約（ViewModel/Presentation）とCLIの読み取り専用な補助表示のみを追加した。

### 2026-07-07（続き）: PR #10 merge後のpost-merge verification（main、完了）

PR #10（`feature/phase4-1-drift-operations` → `main`）をReady化した上でmainへmerge。
`git pull origin main`でfast-forward後のmain上で正式検証を実施した。

- merge commit hash: `1083c95a55b087f220ad441bfc4397763a8e694c`（PR #10、merge済み）
- main commit hash: `1083c95a55b087f220ad441bfc4397763a8e694c`
- `pnpm typecheck` — **pass**（型エラーなし）
- `pnpm test` — **235/235 pass**
- `pnpm detect:drift -- --baseline-from 2025-01-01 --baseline-to 2025-12-31 --recent-from 2026-01-01 --recent-to 2026-07-06 --json` — **pass**（`severity: "none"`、baseline n=2265 / recent n=44）
- `pnpm detect:drift -- (同条件) --presentation-json` — **pass**（`severityLabel: "No drift"`、
  `--rule-id`未指定のため`ruleTitle`/`ruleStatus`ともnull）
- `pnpm run verify:strip-types` — **pass**（29/29）
- `pnpm run verify:roi-smoke` — **pass**（全シナリオ）
- `pnpm run verify:research-rules-dry-run` — **pass**（全チェック）
- `pnpm run verify:drift-smoke` — **pass**（`--presentation-json`必須フィールド・`--rule-id`
  read-only連携・フィクスチャ非書き込みのシナリオを含む全チェック）
- `git status --short`は作業前後とも`reports/*`・`docs/rule-candidates.md`の既存差分のみで、
  それ以外はクリーン。`data/research-rules.json`は生成・残置していない
- 本物のFable/F#/Feliz/.NETは今回も導入していない

**軽微な所見（レビュー時に確認済み、ブロッカーではないため今回は未修正）**:
`scripts/detect-research-drift.ts`の`loadRuleMeta(args.ruleId)`は`--presentation-json`以外の
実行時（`--json`・デフォルトのテキスト出力）でも常に呼ばれる。`data/research-rules.json`への
read-onlyアクセスであり実害は無いが、無駄なI/Oではある。次回の小改善候補として残す
（出力モードに応じて`--presentation-json`指定時のみ呼び出すよう変更する、等）。

**結論**: PR #10のmainへのmergeが完了し、post-merge verificationも全てpassした。
Phase 4.1（Drift Operations）はmainに正式に統合された。

## What to record in completion report

検証結果を完了報告に含める際は、以下を明記する。

- 実行した検証コマンド（`pnpm typecheck` 等の正式コマンドか、`verify:strip-types` 等の
  代替コマンドかを区別する）
- 各コマンドの結果（pass件数、fail件数、exit code）
- 実行できなかったコマンドがあれば、その理由（環境要因か、未実装か）
- 代替検証を行った場合は、次にどの正式コマンドを実行すべきかを明記する
