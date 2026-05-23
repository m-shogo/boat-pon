# Claude Code 引き継ぎメモ

最終更新: 2026-05-24

Boat Pon は個人用の期待値通知・検証アプリ。自動購入、自動投票、ログイン保存、投票サイト操作は絶対に実装しない。
外部サイト取得は候補レースだけ、低頻度、キャッシュ前提で行う。

## 現在の状態

- リポジトリ: `/Users/m-shogo/Developer/personal/boat-pon`
- ブランチ: `main`
- 直近の主な変更 (2026-05-24):
  - `server/db.ts`: `recordOddsSnapshot` で DELETE+INSERT（重複防止）
  - `server/db.ts`: `listOddsSnapshots` の LIMIT 500 を撤廃、MAX(id)で最新1件を返す
  - `scripts/repair-kyotei24-odds-cache.ts`: --min-odds 下限 50→10、--limit 上限 500→2000
  - 連結パターン（98.398→98.3等）を全件修正（541件）
  - 月別100件補完（2025-09〜11各110件）
  - 全BUY/WATCHの current_odds 取得率: **100%**
- 直近の分析結果:
  - BUY 430件、ROI 0.825、的中率 2.79%
  - calibration 2.28倍過大（推定 6.36% vs 実測 2.79%）
  - オッズ20〜50倍がROI最良帯（0.995）
  - 詳細: `docs/odds-quality-report-2026-05-24.md`
- 直近確認:
  - `npm test` 66件全件パス
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

## 推奨: 安全ループCLI

Codex/Claudeのコンテキスト節約には、まず固定ループを使う。
このCLIは `backfill:odds` と `generate:history --refresh-existing --refresh-only --include-skips` を組み合わせ、失敗率が高い時は止まる。

```bash
npm run backfill:odds:loop -- --help
npm run backfill:odds:loop -- --dry-run --from 2025-08-01 --to 2025-08-31
npm run backfill:odds:loop -- --from 2025-08-01 --to 2025-08-31 --max-total 200 --max-batches 4
```

- 1バッチ最大50件。
- 1回の実行は最大500件。
- 失敗率20%以上、429/403/5xx疑いで停止。
- refresh時は既存履歴だけを更新し、新規 `decision_history` は増やさない。
- 完了メモは `/tmp/boat-pon-claude-status.json` に出る。
- `data/` 配下は原則コミットしない。

### 1. 判定履歴を増やす

外部取得なし。保存済みDBだけを読む。
必ず短い dry-run から始める。

```bash
npm run generate:history -- --help
npm run generate:history -- --dry-run --from 2026-04-01 --to 2026-05-21 --limit 500 --include-required-odds-candidates
npm run generate:history -- --from 2026-04-01 --to 2026-05-21 --limit 500 --include-required-odds-candidates
```

広げる時は月単位で進める。いきなり全期間を対象にしない。

### 2. オッズ補完

外部アクセスあり。必ず `--limit` を小さくして、連打しない。
raw HTMLキャッシュがあれば再取得しない。

```bash
npm run backfill:odds -- --help
npm run backfill:odds -- --dry-run --limit 10 --include-skip-required-odds
npm run backfill:odds -- --limit 5 --include-skip-required-odds
```

大量に取らない。1回あたり5〜20件程度で様子を見る。

### 3. 補完済みオッズを判定履歴へ反映

外部取得なし。オッズ補完後に実行する。

```bash
npm run generate:history -- --dry-run --from 2026-05-20 --to 2026-05-21 --limit 200 --refresh-existing --refresh-only --include-skips
npm run generate:history -- --from 2026-05-20 --to 2026-05-21 --limit 200 --refresh-existing --refresh-only --include-skips
```

### 4. 確認

```bash
sqlite3 data/boat.sqlite "SELECT COUNT(*) FROM decision_history; SELECT decision, COUNT(*) FROM decision_history GROUP BY decision; SELECT COUNT(*) FROM odds_snapshots;"
npm test
npm run build
git status --short
```

## 期待値調整の見方

- BUY数が少なすぎる条件は採用しない。
- ROIだけで判断しない。
- 月別ROI、会場別ROI、WATCH化した候補の実績を見る。
- オッズ未取得の候補はBUY採用しない。
- 買わない日が増える改善は成功として扱う。

## 次にClaudeへ頼みたい重い作業

1. **2025年残り月の generate:history 追加**:
   - `npm run generate:history -- --from 2025-01-01 --to 2025-07-31 --limit 1000 --include-required-odds-candidates` で月単位で拡張
   - 各月 dry-run で確認後に実行
2. **calibration 係数の調整**:
   - 推定的中率が実測の 2.3 倍なので、モデルの平滑化係数を調整
   - `src/domain/model.ts` の Laplace スムージングを見直す
3. **オッズ帯絞り込み条件のサンプル拡大**:
   - current_odds < 50 かつ EV 2.0〜3.0 で n=103 → 少なくとも 500 件に拡大してから判断
4. 改善案はコード変更前に `docs/model-roadmap.md` へ短く記録する。

## DBスキーマ注意

- `odds_snapshots`: 同一 (race_id, selection, source) のスナップショットは1件のみ保持（MAX id）
- `recordOddsSnapshot`: DELETE→INSERT で重複しない（2026-05-24 修正済み）
- `listOddsSnapshots(db)`: LIMIT なし、MAX(id) GROUP BY race_id, selection で最新1件返す
