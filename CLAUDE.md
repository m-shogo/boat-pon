# boat-pon — AI エージェント向け運用ガイド

## 絶対禁止事項

- DBへのINSERT/UPDATE/DELETE/DROPは禁止
- app_settings変更禁止
- 本番 decision ロジック変更禁止
- 自動投票・ログイン保存・投票サイト操作禁止
- BUYは検証候補であり購入指示ではない
- ROIは検証指標であり購入推奨ではない
- data/ と backups/ を削除しない

## 現在フェーズ: アーカイブ（2026-10-08〜）

**利益の edge は無いと確定し、撤退条件を満たした。** 根拠・数字・再現手順は [`docs/reviews/2026-10-07-strict-review.md`](docs/reviews/2026-10-07-strict-review.md) と [`docs/profit-feasibility-audit.md`](docs/profit-feasibility-audit.md) の「2026-10-07 最終判定」を参照。

- 事前登録の T-5 市場残差: forward 9,417 レースで全月とも市場に負けた。late money も REJECT。
- paper-live BUY: 175件を精算して実払戻 ROI 63.4%。

### このフェーズでやらないこと

- 新しい ROI 探索・条件の細分化・候補の格上げ監視（旧「候補監視 3点セット」は終了。wind24 などの候補はこの判定で意味を失った）
- 研究基盤（governance・publication・ledger・executor など）の補強や増築
- 研究工場の再開（ChatGPT dispatch、N2 の定期ワークフロー、self-hosted runner）

再開してよいのは、ユーザーが明示した場合だけ。その場合も、**T-5 の市場にまだ入っていない情報源**を具体的に挙げてから、事前登録・時間を区切った1本の検証として行う。

### 停止状態と再開手順

- launchd（`~/Library/LaunchAgents/com.boatpon.*`、`com.shogo.boat-pon.weekly-review`）の plist は残してある。停止・再開はユーザーが行う（手順はレビュー文書の「停止の手順」を参照）。
- GitHub Actions は CI 以外を無効化している。再開するときは `gh api -X PUT repos/m-shogo/boat-pon/actions/workflows/<file>/enable` を使う。
- 削除したブランチや stash は `backups/git-archive-20261008/` に bundle とパッチで退避してある。

## ROI 評価基準

- **主評価**: 公式払戻（`race_results.payout_yen` / `race_payouts.payout_yen`、refund semantics 込み）
- `current_odds`（判定時の表示オッズ）は確定払戻より楽観的。全体で約15pt、BUY の的中時は払戻が表示の 49〜69% だった。ROI の根拠にしない。
- T-5 オッズも、確定払戻は平均して表示の 95% になる。T-5 で計算した EV は 5〜8% 楽観的。

## 検証コマンド

- パッケージ管理は CI と同じ npm（`npm ci`）。`pnpm-lock.yaml` は 2026-06-02 以降更新されていない。
- `npm run verify`（typecheck + test + build）
- 判定の再現: `npx tsx scripts/review-20261007-t5-residual-extended.ts` / `npx tsx scripts/review-20261007-late-money.ts`（read-only、stdout のみ）
