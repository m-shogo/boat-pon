# Development Rules

## 絶対禁止事項（`CLAUDE.md` と同じ、繰り返し）

- DBへのINSERT/UPDATE/DELETE/DROPは禁止
- `app_settings` 変更禁止
- 本番 decision ロジック変更禁止
- 自動投票・ログイン保存・投票サイト操作禁止
- BUYは検証候補であり購入指示ではない
- ROIは検証指標であり購入推奨ではない
- `data/` と `backups/` を削除しない

## 開発ルール

- 既存コードを理解してから実装する
- 小さなコミット、1コミット1目的
- 小さなPR
- テストを書く
- 型安全を維持する
- ロールバック可能にする
- ログを残す
- ドキュメントを更新する
- 既存機能を壊さない
- パフォーマンスは測定してから最適化する
- 不明点は勝手に仕様を決めずTODOとして残す

## 実装方針

一度に巨大な機能は作らない。毎回以下の1セットで止める。

```text
設計 → 実装 → テスト → 検証 → Commit → Push → 停止
```

## このリポジトリの実行コマンド

```sh
pnpm install
pnpm typecheck          # tsc -b
pnpm test               # node --test --import tsx src/domain/*.test.ts
pnpm build              # typecheck + vite build
pnpm verify             # typecheck + test + build
pnpm verify:full        # verify + db:health + validate:data + monitor:live + gitleaks
```

環境によって `pnpm install` がレジストリ制限などで失敗し `tsx`/`tsc` が使えないことがある。
2026-07時点で確認済みのケース: このClaude Code実行環境では `registry.npmjs.org` への
リクエストが常時 `403 host_not_allowed` を返し（メタデータ取得すら失敗）、`pnpm install` が
完了しない。org policyによる意図的な遮断であり、リトライでは解消しないため、**この環境では
`pnpm install` を再試行しない**。

`pnpm install` が通らない環境では代替として Node 22 系の型ストリッピングを使う。

```sh
node --experimental-strip-types <script.ts>
```

ただしNode標準の型ストリッピングは拡張子なしの相対import（`from "./x"`）を解決できないため、
このリポジトリの `src/domain/*.ts`（tsx/vite規約で拡張子なしimport）にそのままは使えない。
`pnpm run verify:strip-types` / `pnpm run verify:roi-smoke`（`node_modules`不要、Node標準機能のみ）
が、importに`.ts`拡張子を補った一時コピーを作ってこの問題を回避する。詳細は
`docs/ai/05-VERIFICATION.md` を参照。

**Phase 3（Rule Lifecycle実装）に着手する前に、通常のpnpm環境で以下を実行し正式合格を
確認すること**。この環境ではこれらは未実行（上記の理由）。

```sh
pnpm typecheck
pnpm test
pnpm explore:roi -- --json
```

typecheck/testが実行できない場合は、実行した代替検証コマンドと未実行のコマンドを完了報告に明記する。

## コードの置き場所の慣習

- 純粋関数のドメインロジック: `src/domain/<name>.ts` + 対になる `src/domain/<name>.test.ts`
- テストは `node:test` + `node:assert/strict`。フィクスチャは最小限のインライン関数で作る（既存の `rollingDrift.test.ts` などを参照）
- 読み取り専用CLI: `scripts/report-*.ts` / `scripts/analyze-*.ts` / `scripts/*-doctor.ts`
- `package.json` の `scripts` にコマンドを追加する場合は既存の命名規則（`report:*`, `analyze:*`, `audit:*` など）に合わせる

## Rule Lifecycle 実装時の注意（Phase 3以降で本格運用）

- ルールの状態は `Idea → Candidate → Backtest → Forward Test → Review → Approved → Production → Monitoring → Deprecated → Archive` を通す
- Productionへ直接追加は禁止。必ず段階を踏む
- Forward Test未通過のルールをProduction扱いにしない
- 状態遷移はコード側でバリデーションする（`src/domain/researchRuleLifecycle.ts` の `canTransitionRuleStatus` / `validateProductionEligibility` を参照）
- 削除はしない。使わなくなったルールは `archived` にするだけ

## 不明点の扱い

仕様が曖昧な場合、コード内に決め打ちを書かず、以下のいずれかで残す。

- コミットメッセージまたはPR説明に「TODO: 要判断」として明記
- `docs/ai/04-ROADMAP.md` の該当Phaseに「未決定事項」として追記
- ユーザーに確認が必要な場合は `AskUserQuestion` 相当の手段で確認する
