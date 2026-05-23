# Claude Code 引き継ぎメモ

最終更新: 2026-05-23

Boat Pon は個人用の期待値通知・検証アプリ。自動購入、自動投票、ログイン保存、投票サイト操作は絶対に実装しない。
外部サイト取得は候補レースだけ、低頻度、キャッシュ前提で行う。

## 現在の状態

- リポジトリ: `/Users/m-shogo/Developer/personal/boat-pon`
- ブランチ: `main`
- 直近の主な追加:
  - `npm run generate:history`
  - `npm run backfill:odds`
  - 補完済みオッズによる `decision_history` 再計算
- 直近確認:
  - `npm test`
  - `npm run build`

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

1. 月単位で `generate:history` を広げる。
2. `backfill:odds` を小ロットで繰り返す。
3. 補完後に `--refresh-existing` で履歴を再計算する。
4. 月別・会場別・番組カテゴリ別に、BUY/WATCH/SKIPとROIの変化をまとめる。
5. 改善案はコード変更前に `docs/model-roadmap.md` へ短く記録する。
