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

## What to record in completion report

検証結果を完了報告に含める際は、以下を明記する。

- 実行した検証コマンド（`pnpm typecheck` 等の正式コマンドか、`verify:strip-types` 等の
  代替コマンドかを区別する）
- 各コマンドの結果（pass件数、fail件数、exit code）
- 実行できなかったコマンドがあれば、その理由（環境要因か、未実装か）
- 代替検証を行った場合は、次にどの正式コマンドを実行すべきかを明記する
