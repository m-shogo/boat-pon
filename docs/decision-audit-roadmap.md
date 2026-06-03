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
pnpm exec tsx scripts/migrate-decision-audit.ts
```

### 6. 判定理由レポートCLIを追加

`scripts/report-decision-reasons.ts` を追加。

読み取り専用で、`decision_history.decision_reasons` を集計する。

実行例:

```bash
pnpm exec tsx scripts/report-decision-reasons.ts -- --from 2026-01-01 --to 2026-06-03
```

---

## 今回ブロックされて完了できなかったこと

GitHub コネクタの安全チェックにより、一部のファイル作成・更新がブロックされた。
以下は未完了として残す。

### 1. `package.json` への script 登録

追加したかった script:

```json
{
  "migrate:decision-audit": "tsx scripts/migrate-decision-audit.ts",
  "report:decision-reasons": "tsx scripts/report-decision-reasons.ts"
}
```

現状は `pnpm exec tsx ...` で直接実行する。

### 2. `server/db.ts` の `insertDecisionHistory()` への保存接続

まだ `decision.reasons` と `candidate.featureAdjustmentBreakdown` は `decision_history` に自動保存されていない。

必要な対応:

- `decision_reasons` に `JSON.stringify(decision.reasons ?? [])` を保存
- `feature_adjustment` に `candidate.featureAdjustment ?? null` を保存
- `feature_adjustment_breakdown` に `JSON.stringify(candidate.featureAdjustmentBreakdown)` を保存
- UPDATE / INSERT の両方に対応
- `listDecisionHistory()` で JSON parse して返す

### 3. `backup-db.ts` の WAL-safe 化

SQLite は WAL mode のため、DB本体の単純コピーだけでは最新状態を取りこぼす可能性がある。

必要な対応:

- `PRAGMA wal_checkpoint(FULL);`
- `VACUUM INTO 'backups/.../boat.sqlite';`
- 補助ファイルは従来通りコピー
- 最新30件保持は維持

### 4. feature audit report

`feature_adjustment_breakdown` を使って、補正要素ごとの結果を集計するCLIを追加したかったがブロックされた。

欲しいレポート:

- factor 別
- 補正帯別 `<0.97`, `0.97-1.00`, `1.00-1.03`, `1.03-1.06`, `1.06+`
- n / settled / hits / ROI(current_odds基準)

### 5. 既存履歴への audit 補完CLI

既存 `decision_history` に対し、過去行の `decision_reasons` を近似補完するCLIを追加したかったがブロックされた。

注意:

- judgeCandidate の完全再現ではなく、履歴分析用の近似auditでよい
- 既存行削除なし
- 外部アクセスなし
- `--dry-run` 必須対応

### 6. テスト追加

`featureAdjustmentBreakdownForSelection()` のテスト追加がブロックされた。

欲しいテスト:

- first boat がない場合は全て 1
- `featureAdjustmentForSelection()` が breakdown.total と一致
- total が 0.65〜1.40 に clamp される

---

## 次にローカルでやること

```bash
cd /Users/m-shogo/Developer/personal/boat-pon

git pull
pnpm typecheck:scripts
pnpm test

pnpm exec tsx scripts/migrate-decision-audit.ts
pnpm health
pnpm exec tsx scripts/report-decision-reasons.ts -- --from 2026-01-01 --to 2026-06-03
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

### S2. `package.json` script 登録

```json
"migrate:decision-audit": "tsx scripts/migrate-decision-audit.ts",
"report:decision-reasons": "tsx scripts/report-decision-reasons.ts"
```

### S3. backup の安全化

`data/boat.sqlite` は単純コピーではなく `VACUUM INTO` で保存する。

### S4. feature audit report

特徴量ごとの効きすぎ・効かなさを検証する。

### S5. テスト追加

`programFeatures.breakdown.test.ts` を追加し、今後の改修で補正内訳が壊れないようにする。

---

## 採用判断ルール

- ROIだけで採用しない
- nが少ない条件は保留
- 月別・会場別・オッズ帯別で見る
- `current_odds` 基準で見る
- 最大的中1本を除いた `roiExMax` も見る
- BUY は購入指示ではなく検証候補
- 自動投票・ログイン保存・投票サイト操作は入れない
