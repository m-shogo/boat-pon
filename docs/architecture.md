# boat-pon Architecture Overview

boat-pon は **競艇の期待値判断を検証・記録・反省するための個人用アプリ**です。

重要方針:

- 自動投票しない
- ログイン情報を保存しない
- 投票サイトを操作しない
- BUY は購入指示ではなく paper 検証候補
- 既存DBと過去データを消さない

## 全体構造

```text
boat-pon
├─ server/          API・DBアクセス・通知・判定履歴保存
├─ src/             UI / domain logic / client側コード
├─ scripts/         取得・検証・レポート・運用CLI
├─ docs/            運用手順・レビュー記録・設計メモ
├─ data/            SQLite DBなどのローカルデータ
├─ backups/         DBバックアップ
└─ design/          サンプル/参照デザイン。実装本体として扱わない
```

## 処理の流れ

```text
公式/取得元データ
  ↓
fetch/import scripts
  ↓
SQLite DB
  ↓
decision generation / dry-run / live monitor
  ↓
decision_history
  ↓
review reports
  ↓
review log / rule candidates / next improvements
```

## 主要レイヤー

### 1. Data acquisition layer

役割:

- 公式結果/番組/オッズ/展示/選手成績などを取得
- DBへ保存
- 欠損を後から catchup / backfill する

代表CLI:

```bash
pnpm fetch:official-results
pnpm fetch:official-programs
pnpm fetch:pending
pnpm backfill:odds
pnpm backfill:beforeinfo
pnpm fetch:racer-stats
```

注意:

- 勝手に大量fetchしない
- daily/catchupで安全な頻度に寄せる
- 取得失敗は削除ではなく再取得候補にする

### 2. DB / persistence layer

役割:

- レース、オッズ、展示、天候、選手、判定履歴を保存
- 反省可能な形で decision_history を維持する

代表ファイル:

```text
server/db.ts
scripts/init-db.ts
scripts/migrate-decision-audit.ts
scripts/decision-audit-doctor.ts
```

現在の重要残タスク:

- `insertDecisionHistory()` に audit fields を直接保存する
  - `decision_reasons`
  - `feature_adjustment`
  - `feature_adjustment_breakdown`
- `listDecisionHistory()` で audit fields を返す

### 3. Decision / model layer

役割:

- 推定的中率
- 必要オッズ
- 現在オッズ
- EV
- BUY/WATCH/SKIP
- model_version
- run_kind

を作る。

重要ルール:

- BUY は検証候補
- 購入指示ではない
- 回収率は検証指標
- live/paperを混同しない

### 4. Review / learning layer

役割:

- 出した判断の良し悪しを見る
- 弱い条件を見つける
- たまたま勝ちを除外する
- 前半/後半でも通用するか見る

代表CLI:

```bash
pnpm report:review-summary
pnpm report:rule-candidates
pnpm report:decision-outcomes
pnpm report:buy-misses
pnpm report:missed-hits
pnpm report:odds-band-outcomes
pnpm report:data-quality-outcomes
pnpm report:calibration
pnpm report:venue-monthly
pnpm report:clv
pnpm report:feature-breakdown

pnpm exec tsx scripts/report-market-warnings.ts
pnpm exec tsx scripts/report-popularity-movement.ts
pnpm exec tsx scripts/report-payout-sensitivity.ts
pnpm exec tsx scripts/report-time-split-stability.ts
pnpm exec tsx scripts/report-model-version-simple.ts
```

一括レビュー:

```bash
pnpm exec tsx scripts/run-review-suite.ts --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
```

レビュー記録作成:

```bash
pnpm exec tsx scripts/create-review-log.ts --date 2026-06-04 --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
```

### 5. Operations / safety layer

役割:

- health check
- backup
- readiness check
- validation

代表CLI:

```bash
pnpm health
pnpm db:health
pnpm validate:data
pnpm audit:doctor
pnpm backup:safe
pnpm exec tsx scripts/check-100-readiness.ts
```

重要残タスク:

- `pnpm backup` を safe default にする
- `backup:legacy` を旧版として残す

## 現在の構造上の強み

- read-only review CLI が多く、判断の反省がしやすい
- `run-review-suite.ts` で一括レビューできる
- `create-review-log.ts` で反省ログを残せる
- `check-100-readiness.ts` で100点化の残りを可視化できる
- 自動投票系を入れない安全方針が明確

## 現在の構造上の弱点

### 1. scripts が肥大化している

`fetch`, `backfill`, `report`, `operation`, `migration` が同じ `scripts/` に集まっている。

当面はこのままでよいが、増え続けるなら次の分割を検討する。

```text
scripts/
├─ fetch/
├─ import/
├─ backfill/
├─ report/
├─ ops/
├─ migrate/
└─ lib/
```

ただし、今すぐ大移動すると既存コマンドが壊れる可能性があるため、まずはドキュメントと runner で整理する。

### 2. server/db.ts が責務過多

DB schema / query / decision_history / notification / persistence が集まりやすい。

将来的な分割候補:

```text
server/db/
├─ schema.ts
├─ decision-history-repository.ts
├─ race-repository.ts
├─ odds-repository.ts
└─ notification-repository.ts
```

短期では `insertDecisionHistory()` の audit保存を先に完了する。

### 3. package scripts が多い

便利だが一覧性が落ちている。

短期対策:

- `docs/architecture.md`
- `scripts/run-review-suite.ts`
- `scripts/check-100-readiness.ts`

長期対策:

- `pnpm review:*`
- `pnpm ops:*`
- `pnpm fetch:*`

の命名整理。

### 4. UI が review CLI に追いついていない

CLIでは見えるが、画面で毎日見るにはまだ弱い。

優先UI:

1. 今日の検証候補
2. market warnings
3. decision reasons
4. feature adjustment breakdown
5. review summary

## 100点に近づける優先順位

### S: まず必須

1. `insertDecisionHistory()` に audit保存を直接接続
2. `listDecisionHistory()` で audit fields を返す
3. `backup` を safe default にする
4. package 未登録reportを登録
5. `check-100-readiness.ts` を green に近づける

### A: 検証精度

1. model version比較を継続運用
2. payout sensitivityを採用前チェックに固定
3. time split stabilityを採用前チェックに固定
4. market warningsを日次確認に入れる

### B: 競艇ドメイン強化

1. 展示順位/平均との差
2. 風向きカテゴリ
3. 進入/前付け/深インリスク
4. レース内モーター/ボート順位

### C: UI/運用

1. review summary UI
2. レース詳細理由表示
3. 反省ログUI
4. daily完了後のレビュー導線

## 推奨コマンド順

通常レビュー:

```bash
pnpm exec tsx scripts/run-review-suite.ts --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
```

100点チェック:

```bash
pnpm exec tsx scripts/check-100-readiness.ts
```

レビュー記録:

```bash
pnpm exec tsx scripts/create-review-log.ts --date 2026-06-04 --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
```

安全検証:

```bash
pnpm typecheck:scripts
pnpm test
pnpm audit:doctor
pnpm backup:safe
```
