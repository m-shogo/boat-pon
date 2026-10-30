# LINE 可読性・外れ検証の作業記録

## 変更前後（同じテスト入力）

`src/domain/buyLineMessageContract.test.ts` の `completeInput()` を変更前と変更後の実装に渡して生成。

### 変更前

```text
🎯 BUY候補: 常滑 8R

race: 2026-08-05-08-08
候補: 1-3-4（3連単）
締切: 2026-08-05 14:32 JST
観測時刻: 2026-08-05 14:26:15 JST
取得オッズ: 6.4倍
必要オッズ: 5.2倍以上
推定的中率: 23.1%
EV: 1.48
推奨stake: 100円
sample: n=184
data: COMPLETE
model: legacy-t5-v1 / paper-live
理由: 必要オッズを上回る / PITデータ完全
警告: なし
公式オッズ: https://www.boatrace.jp/owpc/pc/race/odds3t?rno=8&jcd=08&hd=20260805
投票サイト: https://ib.mbrace.or.jp/

※paper検証候補。自動投票なし。公式オッズと締切を確認して手動で判断してください。
```

### 変更後

```text
🎯 BUY候補 常滑 8R

3連単 1-3-4

⏰ 締切 2026-08-05 14:32 JST（確認 2026-08-05 14:26:15 JST）
💴 推奨 100円
📈 オッズ 6.4倍（必要 5.2倍以上）
🎲 的中率 23.1%　EV 1.48

✅ 理由
・必要オッズを上回る
・PITデータ完全

🔗 公式オッズ
https://www.boatrace.jp/owpc/pc/race/odds3t?rno=8&jcd=08&hd=20260805

投票サイト
https://ib.mbrace.or.jp/

―――
検証用の候補です。自動投票はしません。
公式オッズと締切を確認して、自分で判断してください。
（race 2026-08-05-08-08 / n=184 / data 完全 / model legacy-t5-v1 paper-live）
```

日時の年月日・秒・タイムゾーンも落とさず保持する。LINE の通常テキストでは文字サイズを変えられないため、内部情報は末尾の括弧行にまとめた。

## 外れ検証の結果

`pnpm report:miss-review -- --from 2026-10-01 --to 2026-10-30` の実行結果：

```text
2026-10-01〜2026-10-30 BUY確定 61件 / 的中 0件（予想 3.70件）。
この的中数以下の確率 2.20% → 想定より明らかに悪い（独立・同率の二項近似）。
仮想投入 6,100円 / 実払戻換算 未確定 / ROI 未算出。
```

- 期間内の保存 BUY は63件。公式結果未確定2件を除外。実購入の記録は0円。
- `decision_history.result` が未確定でも、`race_results.trifecta` と `race_payouts` を照合する。返還・未対応券種・不正買い目は別途件数を表示する。
- 公式払戻のカバレッジ不足13件があるため主評価の払戻・ROIを未算出とした。current_odds への代替はしない。
- 予想的中数は保存済み推定率の合計。二項分布の率はその平均。個別確率の違い・相関を反映した厳密検定ではない。
- 保存推定率が通知時点の不変スナップショットと一致するかは未確認。レポートに明示し、後日の再推定や履歴書き換えは行わない。
- 条件別の30件未満は「少数・参考（結論に使わない）」と表示。閾値・モデル・selector・推奨額の変更には使わない。

## 財布ルールの確認

- 差分で `buildBuyLineMessage` の入力検証、`dedupeKey`、`freshness` が不変であることを確認。
- 入力の推奨額0円・100円・12345円がそのまま本文に出るテスト、丸め方を含む同一入力の全文テストを実行。
- 理由80件・警告80件を含むテストで、タイトル込みの本文が `LINE_TEXT_MAX_LENGTH` 以下で、送信テキスト生成時も切り落とされないことを検証。
- 理由や警告の入力長は既存契約に上限がないため、任意長入力までの上限保証はできない。送信条件や既存の切り詰め処理は変更していない。無制限入力を情報欠落なしで送る場合の分割契約は別途検討事項。
- 判定・賭け金計算・selector・通知送信のコード、`app_settings`、本番DBには変更を加えていない。新レポートは `readOnly: true` と `PRAGMA query_only = ON` で開く。DB更新SQLはテスト用一時DBのフィクスチャのみ。
- 既存レポートはSQL・集計を変更せず表示だけを追加。通常は日本語の少数列と上位10行、`--detail` は既存の詳細、既存 `--json` の形を維持。取得上限がある一覧では「取得範囲」と明示し、全期間の件数と混同しない。

## 検証

- `npm run typecheck`: 成功。
- `npm run typecheck:scripts`: 成功。
- `npm test`: 初回は sandbox の EPERM と macOS の `/var` シンボリックリンクを拒否する既存テストが失敗。制限外で `TMPDIR=/private/tmp npm test` を実行し、4095件すべて成功。
- `node scripts/verify-product-boundaries.mjs`: 成功。
- `node scripts/verify-buy-line-learning-boundaries.mjs`: 成功。
- 新レポートの一時DBによる結合・日付・JSON検証と、読み取り前後のDB SHA-256一致を確認。
- 既存レポートを変更前のソースと同じ期間で実行し、`generatedAt` 以外のJSONが一致。CLV・市場警告・人気変動は変更前後とも既存検証で停止したため、実DBでのJSON比較は未実施。
- `npm run build`: 成功（Fable・TypeScript・Vite）。
- `pnpm report:miss-review -- --from 2026-10-01 --to 2026-10-30`: 成功。初回の tsx IPC は sandbox に拒否されたため制限外で実行。

## 変更ファイル

- `README.md`
- `docs/codex/line-readability-and-miss-review-result.md`
- `package.json`
- `scripts/report-buy-misses.ts`
- `scripts/report-calibration.ts`
- `scripts/report-clv.ts`
- `scripts/report-daily.ts`
- `scripts/report-data-quality-outcomes.ts`
- `scripts/report-decision-outcomes.ts`
- `scripts/report-feature-breakdown.ts`
- `scripts/report-market-warnings.ts`
- `scripts/report-miss-review.ts`
- `scripts/report-missed-hits.ts`
- `scripts/report-odds-band-outcomes.ts`
- `scripts/report-payout-sensitivity.ts`
- `scripts/report-popularity-movement.ts`
- `scripts/report-quality.ts`
- `scripts/report-review-summary-raw.ts`
- `scripts/report-review-summary.ts`
- `scripts/report-rule-candidates.ts`
- `scripts/report-time-split-stability.ts`
- `scripts/report-venue-monthly.ts`
- `src/domain/buyLineMessageContract.test.ts`
- `src/domain/buyLineMessageContract.ts`
- `src/presentation/missReview.test.ts`
- `src/presentation/missReview.ts`
- `src/presentation/missReviewE2e.test.ts`
- `src/presentation/reviewReportText.test.ts`
- `src/presentation/reviewReportText.ts`
