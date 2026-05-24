# Claude Code 引き継ぎメモ

最終更新: 2026-05-24 (セッション2)

Boat Pon は個人用の期待値通知・検証アプリ。自動購入、自動投票、ログイン保存、投票サイト操作は絶対に実装しない。
外部サイト取得は候補レースだけ、低頻度、キャッシュ前提で行う。

## 現在の状態

- リポジトリ: `/Users/m-shogo/Developer/personal/boat-pon`
- ブランチ: `main`
- 直近の主な変更 (2026-05-24 セッション2):
  - `src/domain/kyotei24Odds.ts`: `MAX_VALID_ODDS=1000` ガード追加（欠場レース誤パース修正）
  - `src/domain/types.ts`: `BudgetRule` に `marketBlendWeight?: number` 追加
  - `src/domain/decision.ts`: `blendedHitRate()` 実装、`judgeCandidate` に `marketBlendWeight` 組み込み
  - `src/domain/decision.test.ts`: テスト 71件（全パス）
  - オッズスナップショット: **9,216件** → 9,216+（各月 940〜1,145件）
  - decision_history: BUY 3,120件、WATCH 863件、SKIP 37,279件（2025年計）

- 最新分析結果（2026-05-24 セッション2 最終版）:
  - 全BUY: n=3,120、ROI 0.733、的中率 2.37%（74的中）
  - **ratio1.5-2.0 帯**: n=698、ROI 0.861、的中率 2.58%（18的中）
  - **ratio1.5-2.0 + 5-11月**: n=397、ROI 1.069 ← 唯一ROI>1
  - marketBlendWeight: ROI 改善効果は限定的（ratio フィルターが先に効く）
  - キャリブレーション: 10-20倍は1.5x過大、30-50倍は4x過大、50倍超は10倍以上過大
  - 詳細: `docs/model-roadmap.md`, `docs/odds-quality-report-2026-05-24.md`

- 直近確認:
  - `npm test` 71件全件パス
  - `npm run build` 成功

## 触らないもの

別エージェントや長時間ジョブと衝突させない。

- `data/raw/official/results/`
- `data/raw/official/programs/`
- `data/tmp/`
- `/tmp/boat-pon-*.log`
- `/tmp/boat-pon-*.pid`

禁止:

- `npm run fetch:official-results`
- `npm run fetch:official-programs`
- `npm run fetch:kyotei24`
- `pkill` / `kill`
- `rm data/raw/*`

## 重い作業の進め方

### 推奨: 安全ループCLI

Codex/Claudeのコンテキスト節約には、まず固定ループを使う。

```bash
npm run backfill:odds:loop -- --help
npm run backfill:odds:loop -- --dry-run --from 2025-08-01 --to 2025-08-31
npm run backfill:odds:loop -- --from 2025-08-01 --to 2025-08-31 --max-total 200 --max-batches 4
```

- 1バッチ最大50件。失敗率20%以上、429/403/5xx疑いで停止。

### 1. オッズ補完（継続中）

各月まだ1,500〜3,000件のSKIPが未補完。200件ずつ追加中。

```bash
npm run backfill:odds -- --limit 200 --include-skip-required-odds --from 2025-01-01 --to 2025-01-31 --sleep-ms 1200
# 補完後に再計算
npm run generate:history -- --from 2025-01-01 --to 2025-01-31 --limit 50000 --refresh-existing --refresh-only --include-skips
```

### 2. 判定履歴を増やす

```bash
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-24 --limit 500
npm run generate:history -- --from 2026-05-01 --to 2026-05-24 --limit 500
```

### 3. 確認

```bash
sqlite3 data/boat.sqlite "SELECT decision, COUNT(*) FROM decision_history WHERE date >= '2025-01-01' AND date <= '2025-11-30' GROUP BY 1; SELECT COUNT(*) FROM odds_snapshots;"
npm test
npm run build
git status --short
```

## 期待値調整の見方

- BUY数が少なすぎる条件は採用しない
- ROIだけで判断しない
- 月別ROI、会場別ROI、WATCH化した候補の実績を見る
- オッズ未取得の候補はBUY採用しない
- 買わない日が増える改善は成功として扱う

## 次にClaudeへ頼みたい重い作業

1. **オッズ補完の継続**:
   - 2025-01〜07: 各月あと1,500〜2,000件のSKIPが未補完（1日200件ペースで継続）
   - 2025-09〜11: 各月約700件のSKIPが未補完（200件ずつ追加中）
   - コマンド: `npm run backfill:odds -- --limit 200 --include-skip-required-odds --from 2025-XX-01 --to 2025-XX-31 --sleep-ms 1200`

2. **calibration 係数の調整**（中優先）:
   - `buildVenueModel` の cherry-picking バイアス: トップセレクション選択で過大推定
   - 対策候補: (a) alpha 引き上げ、(b) minHitCount 閾値追加、(c) 市場オッズ混合（実装済み、効果限定的）
   - 実装前に `docs/model-roadmap.md` へ方針を記録すること

3. **ratio1.5-2.0 フィルターの季節性検証**:
   - 1-4月 ROI 0.467 vs 5-11月 ROI 1.069
   - データ追加後に再検証（現状過学習の可能性あり）

4. **selection 1-3-2 の追加検証**:
   - 平和島で ROI 3.19 (n=26)、大村で ROI 1.49 (n=17) — 過小サンプル
   - データ追加後に n>=50 になってから採用判断

## DBスキーマ注意

- メインDB: `data/boat.sqlite`（`data/boat-pon.db` は0バイトダミー、使わない）
- `odds_snapshots`: 同一 (race_id, selection, source) のスナップショットは1件のみ保持
- `recordOddsSnapshot`: DELETE→INSERT で重複しない
- `listOddsSnapshots(db)`: LIMIT なし、MAX(id) GROUP BY race_id, selection で最新1件返す
- ROI計算: `SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*)` (100円ベット基準)
