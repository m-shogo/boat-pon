# Audit Persistence Implementation Guide

目的: `decision_history` に **判断した瞬間の理由・補正・特徴量内訳** を直接保存する。

これは boat-pon の100点化における本丸です。

## 絶対ルール

- 既存DB・既存データを削除しない
- `DROP TABLE` しない
- `data/` と `backups/` を消さない
- 自動投票を入れない
- ログイン保存を入れない
- 投票サイト操作を入れない
- 外部fetchを勝手に実行しない
- BUY は購入指示ではなく paper 検証候補

## 現在の確認コマンド

```bash
pnpm check:100
pnpm audit:persistence
pnpm audit:persistence -- --strict
```

## 目的の保存カラム

`decision_history` に以下を保存する。

```text
decision_reasons
feature_adjustment
feature_adjustment_breakdown
```

DBカラムがない場合は先に実行する。

```bash
pnpm migrate:decision-audit
```

## 実装対象

主対象:

```text
server/db.ts
```

主に触る関数:

```text
insertDecisionHistory()
listDecisionHistory()
```

## 実装方針

### 1. 保存値を作る

`insertDecisionHistory()` 内で、SQL実行前に以下を用意する。

```ts
const decisionReasonsJson = JSON.stringify(decision.reasons ?? []);
const featureAdjustment = typeof candidate.featureAdjustment === "number"
  ? candidate.featureAdjustment
  : 0;
const featureAdjustmentBreakdownJson = candidate.featureAdjustmentBreakdown
  ? JSON.stringify(candidate.featureAdjustmentBreakdown)
  : null;
```

候補オブジェクトの型が違う場合は、既存型 `BetCandidate` に合わせて安全に optional access する。

### 2. UPDATE に追加する

`insertDecisionHistory()` の `UPDATE decision_history SET ...` に以下を追加する。

```sql
decision_reasons = ?,
feature_adjustment = ?,
feature_adjustment_breakdown = ?,
```

対応する bind values に以下を追加する。

```ts
decisionReasonsJson,
featureAdjustment,
featureAdjustmentBreakdownJson,
```

### 3. INSERT に追加する

`INSERT INTO decision_history (...)` のカラム一覧に追加する。

```sql
decision_reasons,
feature_adjustment,
feature_adjustment_breakdown,
```

VALUES 側にも `?, ?, ?` を追加する。

bind values に以下を追加する。

```ts
decisionReasonsJson,
featureAdjustment,
featureAdjustmentBreakdownJson,
```

### 4. listDecisionHistory() で返す

SELECT に以下を追加する。

```sql
decision_reasons,
feature_adjustment,
feature_adjustment_breakdown,
```

返却オブジェクトに以下を追加する。

```ts
decisionReasons: parseJsonArray(row.decision_reasons),
featureAdjustment: row.feature_adjustment ?? 0,
featureAdjustmentBreakdown: parseJsonObject(row.feature_adjustment_breakdown),
```

安全なparse helperを使う。

```ts
function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
```

## 通知文言の安全化

先にdry-runする。

```bash
pnpm patch:paper-wording -- --dry-run
```

問題なければ適用する。

```bash
pnpm patch:paper-wording -- --write
```

## 実装後の検証

```bash
pnpm typecheck:scripts
pnpm test
pnpm audit:persistence
pnpm check:100
pnpm check:100-suite -- --keep-going
```

レビュー込みなら:

```bash
pnpm check:100-suite -- --with-review --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
```

## 完了条件

以下がOKになること。

```bash
pnpm audit:persistence -- --strict
```

特に見る項目:

- `server mentions decision_reasons`
- `server mentions feature_adjustment`
- `server mentions feature_adjustment_breakdown`
- `API row exposes decisionReasons`
- `API row exposes featureAdjustmentBreakdown`
- `DB column decision_reasons`
- `DB column feature_adjustment`
- `DB column feature_adjustment_breakdown`
- `paper wording safe`

## Claude/Codex用プロンプト

```text
対象リポジトリ:
/Users/m-shogo/Developer/personal/boat-pon

目的:
server/db.ts の decision_history に audit fields を直接保存してください。

絶対ルール:
- 既存DB・既存データを削除しない
- DROP TABLEしない
- data/ と backups/ を消さない
- 自動投票は絶対に入れない
- ログイン保存は絶対に入れない
- 投票サイト操作は絶対に入れない
- 外部fetchを勝手に実行しない
- BUYは購入指示ではなくpaper検証候補

作業:
1. git status --short を確認
2. pnpm audit:persistence を実行して現状確認
3. DBカラムがなければ pnpm migrate:decision-audit を実行
4. server/db.ts の insertDecisionHistory() に以下を直接保存
   - decision_reasons
   - feature_adjustment
   - feature_adjustment_breakdown
5. listDecisionHistory() で以下を返す
   - decisionReasons
   - featureAdjustment
   - featureAdjustmentBreakdown
6. pnpm patch:paper-wording -- --dry-run を確認し、問題なければ --write
7. 検証
   pnpm typecheck:scripts
   pnpm test
   pnpm audit:persistence -- --strict
   pnpm check:100
   pnpm check:100-suite -- --keep-going
8. git diff を確認
9. コミット・push

完了報告:
- 変更ファイル
- 実行した検証
- 自動投票/ログイン保存/投票サイト操作が入っていないこと
- コミットハッシュ
```
