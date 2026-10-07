# boat-pon — AI エージェント向け運用ガイド

## 絶対禁止事項

- DBへのINSERT/UPDATE/DELETE/DROPは禁止
- app_settings変更禁止
- 本番 decision ロジック変更禁止
- 自動投票・ログイン保存・投票サイト操作禁止
- BUYは検証候補であり購入指示ではない
- ROIは検証指標であり購入推奨ではない
- data/ と backups/ を削除しない

## 現在フェーズ: 撤退後の最小運用（2026-10-08〜）

**利益の edge は無いと確定し、撤退条件を満たした。** 根拠・数字・再現手順は [`docs/reviews/2026-10-07-strict-review.md`](docs/reviews/2026-10-07-strict-review.md) と [`docs/profit-feasibility-audit.md`](docs/profit-feasibility-audit.md) の「2026-10-07 最終判定」を参照。

- 事前登録の T-5 市場残差: forward 9,417 レースで、全月とも市場に負けた。late money も REJECT。
- paper-live BUY: 175件を精算して、実払戻 ROI 63.4%。

ユーザーの判断（2026-10-08）で、通知と収集は続ける。目標は2つだけ:
1. **当たり外れを正しく伝える**（公式払戻で精算する）。
2. **確率の精度を上げる**（物差しは市場補正の確率。`npm run report:accuracy-scorecard`）。

### 続けるもの

- auto-odds・auto-exhibition・番組と結果の取り込み（全券種の払戻・各艇成績・気象も毎日保存）・LINE 通知（BUY 即時・日次まとめ・確定結果）
- BUY の結果の速報: `scripts/notify-buy-results-fast.ts`（10分ごと。締切 8分後から公式の結果ページを見る。launchd への登録はユーザーが行う）
- 成長ループ: `scripts/publish-accuracy-scorecard.sh` が毎晩 22:15 に、週次の改善処理（`run-accuracy-growth.ts`）→ スコアカード（`data/reports/scorecard/` に履歴とイベントを蓄積）→ 公開版を `automation/scorecard` へ、の順に実行する（launchd への登録はユーザーが行う）。改善処理が入れ替えるのは市場補正のパラメータだけで、BUY の判定は変えない
- ChatGPT の定期タスク: 1日1回、スコアカードを読んで報告し、週1回は目的監査をする（プロンプトは [`docs/chatgpt-scheduled-task-bridge.md`](docs/chatgpt-scheduled-task-bridge.md) の改訂版）

### 止めるもの・やらないこと

- 研究工場（研究基盤の補強ループ・intent dispatch・N2 の定期ワークフロー・self-hosted runner・private capture）
- 新しい ROI 探索・条件の細分化・候補の格上げ監視（旧「候補監視 3点セット」は終了した）
- 研究基盤（governance・publication・ledger・executor など）の補強や増築
- 精度改善の変更は「スコアカードのどの数字が・どれだけ動くか」を先に書けるものだけにする

停止の手順と、削除前のバックアップ（`backups/git-archive-20261008/`）は、レビュー文書の末尾にある。

## ROI 評価基準

- **主評価**: 公式払戻（`race_results.payout_yen` / `race_payouts.payout_yen`、refund semantics 込み）
- `race_payouts` は 2026-06-02〜10-06 が空（毎日の取り込みに入っていなかった。2026-10-08 に修正）。埋め戻すまでは、3連単は `race_results.payout_yen` を使う
- `current_odds`（判定時の表示オッズ）は確定払戻より楽観的。全体で約15pt、BUY の的中時は払戻が表示の 49〜69% だった。ROI の根拠にしない。
- T-5 オッズも、確定払戻は平均して表示の 95% になる。T-5 で計算した EV は 5〜8% 楽観的。

## 検証コマンド

- パッケージ管理は CI と同じ npm（`npm ci`）。`pnpm-lock.yaml` は 2026-06-02 以降更新されていない。
- `npm run verify`（typecheck + test + build）
- 判定の再現: `npx tsx scripts/review-20261007-t5-residual-extended.ts` / `npx tsx scripts/review-20261007-late-money.ts`（read-only、stdout のみ）
