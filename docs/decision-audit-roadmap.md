# Decision Audit Roadmap

最終更新: 2026-06-03

## 目的

boat-pon を「予想を出すだけのアプリ」ではなく、**なぜその判断になったか・なぜ外れたかを後から検証できるアプリ**にする。

BUY は購入指示ではなく、paper live / 検証候補として扱う。自動投票・ログイン保存・投票サイト操作は入れない。

---

## 今回できたこと

### 1. 特徴量補正の内訳を追加

`src/domain/programFeatures.ts` に以下を追加。

- `FeatureAdjustmentBreakdown`
- `featureAdjustmentBreakdownForSelection()`

これにより、従来は `featureAdjustment = 1.08` のような合計値だけだったものを、以下のように分解できる。

```ts
{
  total: 1.08,
  classFactor: 1.04,
  nationalFactor: 1.02,
  localFactor: 1.01,
  motorFactor: 1.00,
  boatFactor: 0.99,
  courseStFactor: 1.01,
  courseTop3Factor: 1.02,
  exhibitionResidualFactor: 1.01,
  secondClassFactor: 1.02,
  secondLocalFactor: 1.01,
  thirdClassFactor: 1.00
}
```

### 2. 既存互換を維持

`featureAdjustmentForSelection()` は引き続き `number` を返す。
内部では `featureAdjustmentBreakdownForSelection(...).total` を返すため、既存ロジックは壊さない。

### 3. 候補生成に内訳を保持

`src/domain/model.ts` の `buildCandidatesFromModel()` で以下を計算し、`BetCandidate` に持たせる。

```ts
const featureAdjustmentBreakdown = featureAdjustmentBreakdownForSelection(input.features, selection);
const featureAdjustment = featureAdjustmentBreakdown.total;
```

### 4. 型追加

`src/domain/types.ts` に `BetCandidate.featureAdjustmentBreakdown` を追加。
`src/domain/backtest.ts` に以下の監査用フィールドを追加。

- `decisionReasons?: string[]`
- `featureAdjustment?: number | null`
- `featureAdjustmentBreakdown?: FeatureAdjustmentBreakdown | null`

### 5. decision_history 用 migration script を追加

`scripts/migrate-decision-audit.ts` を追加。

追加カラム:

```sql
ALTER TABLE decision_history ADD COLUMN decision_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE decision_history ADD COLUMN feature_adjustment REAL;
ALTER TABLE decision_history ADD COLUMN feature_adjustment_breakdown TEXT;
```

実行:

```bash
pnpm migrate:decision-audit
```

### 6. 判定理由レポートCLIを追加

`scripts/report-decision-reasons.ts` を追加。

読み取り専用で、`decision_history.decision_reasons` を集計する。

実行例:

```bash
pnpm report:decision-reasons -- --from 2026-01-01 --to 2026-06-03
```

### 7. CLVレポートCLIを追加

`scripts/report-clv.ts` を追加。

読み取り専用で、`odds_timeseries_snapshots` と `decision_history` を使い、T-30 / T-20 / T-10 / T-5 の平均オッズと、T-30 から T-5 への変化率を見る。

実行例:

```bash
pnpm report:clv -- --from 2026-01-01 --to 2026-06-03
```

見るポイント:

- BUY候補のオッズが締切に向けて下がるなら、市場より早く拾えている可能性がある
- BUY候補のオッズが締切に向けて上がるなら、市場が嫌っている可能性がある
- ROIだけでなくCLVを見て、最大配当1本依存を避ける

### 8. feature breakdown レポートCLIを追加

`scripts/report-feature-breakdown.ts` を追加。

読み取り専用で、`feature_adjustment_breakdown` を factor 別・補正帯別に集計する。

実行例:

```bash
pnpm report:feature-breakdown -- --from 2026-01-01 --to 2026-06-03
```

見るポイント:

- `classFactor` が効きすぎていないか
- `motorFactor` / `boatFactor` が結果に寄与しているか
- `exhibitionResidualFactor` が過大評価になっていないか
- `total` が高い帯ほど本当に結果が良いか

### 9. decision audit doctor を追加

`scripts/decision-audit-doctor.ts` を追加。

読み取り専用で、audit系の導入状態を確認する。

現状 `package.json` への `audit:doctor` 登録は未完了のため、直接実行する。

```bash
pnpm exec tsx scripts/decision-audit-doctor.ts
```

確認内容:

- 追加CLIファイルの有無
- package script の有無
- DBの有無
- `decision_history` のaudit用カラム有無
- `odds_timeseries_snapshots` の有無

### 10. テスト追加

`src/domain/programFeatures.breakdown.test.ts` を追加。

確認内容:

- first boat がない場合は全て 1
- `featureAdjustmentForSelection()` が breakdown.total と一致
- total が 0.65〜1.40 に clamp される

---

## まだ完了できていないこと

### 1. `server/db.ts` の `insertDecisionHistory()` への保存接続

まだ `decision.reasons` と `candidate.featureAdjustmentBreakdown` は `decision_history` に自動保存されていない。

必要な対応:

- `decision_reasons` に `JSON.stringify(decision.reasons ?? [])` を保存
- `feature_adjustment` に `candidate.featureAdjustment ?? null` を保存
- `feature_adjustment_breakdown` に `JSON.stringify(candidate.featureAdjustmentBreakdown)` を保存
- UPDATE / INSERT の両方に対応
- `listDecisionHistory()` で JSON parse して返す

### 2. `backup-db.ts` の WAL-safe 化

SQLite は WAL mode のため、DB本体の単純コピーだけでは最新状態を取りこぼす可能性がある。

必要な対応:

- `PRAGMA wal_checkpoint(FULL);`
- `VACUUM INTO 'backups/.../boat.sqlite';`
- 補助ファイルは従来通りコピー
- 最新30件保持は維持

### 3. 既存履歴への audit 補完CLI

既存 `decision_history` に対し、過去行の `decision_reasons` を近似補完するCLIが未完了。

注意:

- judgeCandidate の完全再現ではなく、履歴分析用の近似auditでよい
- 既存行削除なし
- 外部アクセスなし
- `--dry-run` 必須対応

### 4. `audit:doctor` script 登録

`scripts/decision-audit-doctor.ts` は追加済みだが、`package.json` への `audit:doctor` 登録はブロックされた。

現状は以下で実行する。

```bash
pnpm exec tsx scripts/decision-audit-doctor.ts
```

---

## 次にローカルでやること

```bash
cd /Users/m-shogo/Developer/personal/boat-pon

git pull
pnpm typecheck:scripts
pnpm test

pnpm migrate:decision-audit
pnpm health
pnpm report:decision-reasons -- --from 2026-01-01 --to 2026-06-03
pnpm report:clv -- --from 2026-01-01 --to 2026-06-03
pnpm report:feature-breakdown -- --from 2026-01-01 --to 2026-06-03
pnpm exec tsx scripts/decision-audit-doctor.ts
```

---

## 次の実装優先順位

### S1. `server/db.ts` へ監査保存を接続

最優先。

`insertDecisionHistory()` の UPDATE / INSERT に以下を追加する。

```ts
const decisionReasonsJson = JSON.stringify(decision.reasons ?? []);
const featureAdjustmentBreakdownJson = candidate.featureAdjustmentBreakdown
  ? JSON.stringify(candidate.featureAdjustmentBreakdown)
  : null;
```

保存カラム:

- `decision_reasons`
- `feature_adjustment`
- `feature_adjustment_breakdown`

### S2. backup の安全化

`data/boat.sqlite` は単純コピーではなく `VACUUM INTO` で保存する。

### S3. 既存履歴への audit 補完CLI

過去の `decision_history` に近似理由を付け、理由別レポートをすぐ見られるようにする。

---

## 採用判断ルール

- ROIだけで採用しない
- nが少ない条件は保留
- 月別・会場別・オッズ帯別で見る
- `current_odds` 基準で見る
- 最大的中1本を除いた `roiExMax` も見る
- BUY は購入指示ではなく検証候補
- 自動投票・ログイン保存・投票サイト操作は入れない
