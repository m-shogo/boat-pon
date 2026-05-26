# Claude Code 次作業指示

目的: Boat Pon の v4-conservative を、DBを汚さず検証できる状態にする。ユーザーに技術判断を丸投げせず、Claude/Codex/テスト/読み取りSQLで判断材料を作る。

## 作業場所

```sh
cd /Users/m-shogo/Developer/personal/boat-pon
```

`/Users/m-shogo/Documents/boat-pon` では作業しない。そこは実repoへの入口であり、作業場所は必ず上記に固定する。

## 判断ルール

ユーザーに「AとBどちらが技術的に正しいか」を聞かない。まず自分でコード、DBスキーマ、既存ドキュメントを読み、読み取りSQL、小さい一時DB、テスト、ビルドで判断する。

判断に迷う場合は Codex にレビュー/相談する。Codex の回答も鵜呑みにせず、必ず実コマンドと差分で検証してから反映する。

ユーザー確認が必要なもの:

- 外部サイトへ大量アクセスする
- DBに大量 INSERT / UPDATE / DELETE する
- 2026年 live `decision_history` を書き込む
- `git reset`, `git checkout --`, `rm` など破壊的操作
- 秘密情報、認証、SSH/Git設定を変更する
- 自動購入、自動投票、ログイン保存、投票サイト操作に関わる実装
- 取り返しにくい設計変更や既存データを破棄する変更

ユーザー確認が不要なもの:

- 読み取り専用SQL
- 小さい一時DBでの検証
- テスト追加
- 型修正
- ドキュメント整備
- `npm run verify`
- `npm run monitor:live`
- `gitleaks detect --no-banner --redact`
- DBを汚さない評価スクリプト追加
- 安全側に倒すUI/説明改善

## 絶対禁止

- 自動購入、自動投票、ログイン保存、投票サイト操作を実装しない
- `fetch:official-results`, `fetch:official-programs`, `fetch:kyotei24` を勝手に実行しない
- `data/raw/official` を触らない
- 2026年対象の `generate:history` 書き込みをしない
- ROI検証に `payout_yen` を使わない。検証ROIは `current_odds` 基準に統一する
- `data/` と `.claude/` をコミットしない

## 優先作業

### 1. 読み取り専用 v4 評価スクリプト

`scripts/evaluate-v4-conservative.ts` を追加する。

要件:

- 既存DB `data/boat.sqlite` を読むだけ
- `decision_history` へ INSERT / UPDATE / DELETE しない
- `official_programs`, `race_results`, `odds_snapshots` から、指定期間の番組・結果・最新オッズを使って v4 候補を再計算する
- `buildVenueModel`, `buildCandidatesFromModel`, `judgeCandidate` を通す
- ROIは `current_odds` 基準
- v3/v4履歴と混ぜない

CLI:

```sh
npm run evaluate:v4 -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N
npm run evaluate:v4 -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N --json
npm run evaluate:v4 -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N --train-days 365
```

出力:

- 全体: races, modeled, BUY/WATCH/SKIP, hits, ROI, avgRequiredOdds, avgCurrentOdds, avgOddsRatio
- 年別
- 月別
- 会場別
- required_odds帯別
- odds_ratio帯別
- className別
- rawEstimatedHitRate と conservativeHitRate の平均、保守化率
- 2026年を対象にした場合は「読み取り専用評価であり live 判断には使わない」と明記

### 2. v3履歴との参考比較

`evaluate:v4` の出力に、同期間の既存 `decision_history` があれば参考比較を出す。

- `model_version` で必ず分離する
- v3とv4を混ぜたROIを出さない
- v3履歴が古い設定由来なら「参考値」と明記する

### 3. DBヘルスチェック

`scripts/check-db-health.ts` を追加する。読み取り専用。

確認項目:

- `decision_history` に `raw_estimated_hit_rate`, `conservative_hit_rate`, `model_selection_score` がある
- 2026年に v4以外のBUYがある場合は診断として表示
- 2026年に generate:history由来のv4大量行がないか、source/model_version/dateで表示
- duplicate race_id BUY/WATCH がないか
- `data/boat-pon.db` が0バイトなら「使わないDB」と明記

追加npm script:

```json
"db:health": "tsx scripts/check-db-health.ts"
```

### 4. npm scripts

`package.json` に追加する。

```json
"evaluate:v4": "tsx scripts/evaluate-v4-conservative.ts",
"db:health": "tsx scripts/check-db-health.ts",
"verify:full": "npm run verify && npm run db:health && npm run monitor:live && gitleaks detect --no-banner --redact"
```

READMEにも短く追記する。

### 5. 検証レポート

`docs/v4-conservative-validation-2026-05-26.md` を追加する。

まず小さい期間で実行:

```sh
npm run evaluate:v4 -- --from 2025-01-01 --to 2025-01-31 --limit 500
```

問題なければ:

```sh
npm run evaluate:v4 -- --from 2025-01-01 --to 2025-11-30 --limit 50000
```

余裕があれば:

```sh
npm run evaluate:v4 -- --from 2024-01-01 --to 2025-11-30 --limit 100000
```

レポートは「採用/不採用」ではなく「判断材料」として書く。ROIだけで結論を出さず、n、月別、会場別、ratio帯別、最大払戻依存を見る。

### 6. テスト

可能なら評価ロジックの純粋関数を `src/domain` に切り出してテストする。

最低限追加したいテスト:

- v4評価の集計が `current_odds` 基準でROIを出す
- raw/conservative/selectionScore が候補から履歴へ保持される
- DBヘルスチェックが新3カラムを検出する
- 2026 live 汚染候補を診断表示する

## 最後の確認

必ず実行する。

```sh
npm run verify:full
git status --short --branch
```

`verify:full` が未追加の途中段階では以下を個別に実行する。

```sh
npm run verify
npm run db:health
npm run monitor:live
gitleaks detect --no-banner --redact
git status --short --branch
```

## コミット前確認

- `data/` はコミットしない
- `.claude/` は基本コミットしない
- 実DBへの大量書き込みをしていない
- 外部取得をしていない
- 2026年 `decision_history` 書き込みをしていない
- Claude/Codexレビュー結果を鵜呑みにせず、テストと実コマンドで確認している

コミットメッセージ案:

```text
v4モデル検証レールを追加
```
