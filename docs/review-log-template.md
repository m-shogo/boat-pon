# boat-pon Review Log Template

目的: `run-review-suite` の結果を貼り付けて、毎回の反省と次の改善を残すためのテンプレート。

## 基本情報

- 実施日:
- 対象期間:
- split date:
- model version:
- run kind:
- 実行コマンド:

```bash
pnpm exec tsx scripts/run-review-suite.ts --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD --min-settled 50
```

## 1. 全体サマリー

貼り付け:

```text
# report:review-summary
```

メモ:

- BUY件数:
- WATCH件数:
- SKIP件数:
- BUY外れ:
- WATCH/SKIP的中:
- audit coverage:

判断:

- [ ] 問題なし
- [ ] BUYが多すぎる
- [ ] WATCHに落としすぎ
- [ ] SKIP条件が強すぎる
- [ ] audit保存/補完が不足

## 2. ルール候補

貼り付け:

```text
# report:rule-candidates
```

候補:

| 候補 | 条件 | n/settled | roi | roiExMax | 判断 |
|---|---|---:|---:|---:|---|
| tighten-buy / review-watch-skip |  |  |  |  | 採用 / 保留 / 却下 |

採用しない理由:

- n不足
- 大当たり依存
- 前半/後半で不安定
- 会場限定すぎる
- データ不足由来

## 3. 時系列安定性

貼り付け:

```text
# report-time-split-stability
```

見るポイント:

- stable-good:
- stable-bad:
- reversed:
- insufficient:

結論:

- [ ] 採用候補あり
- [ ] まだ保留
- [ ] 過学習っぽいので採用しない

## 4. 大当たり依存

貼り付け:

```text
# report-payout-sensitivity
```

見るポイント:

- roi:
- roiExTop1:
- roiExTop3:
- roiExTop5:

判断:

- [ ] 安定している
- [ ] 最大配当1本依存
- [ ] 上位3本依存
- [ ] 上位5本依存

## 5. 市場警告

貼り付け:

```text
# report-market-warnings
```

気になったもの:

| date | venue | race | decision | selection | warning | メモ |
|---|---|---:|---|---|---|---|

判断:

- [ ] BUYで市場悪化が多い
- [ ] WATCH/SKIPで市場良化が多い
- [ ] 市場警告は少ない

## 6. データ品質

貼り付け:

```text
# report:data-quality-outcomes
```

見るポイント:

- before_info complete / incomplete:
- environment high / medium / low:
- sample size band:

判断:

- [ ] データ不足時のBUYを弱める
- [ ] environment highのBUYを弱める
- [ ] sample不足時のBUYを弱める

## 7. 確率校正

貼り付け:

```text
# report:calibration
```

見るポイント:

- 推定的中率帯:
- 実測的中率:
- 自信過剰な帯:
- 過小評価している帯:

判断:

- [ ] モデルは概ね校正されている
- [ ] 自信過剰
- [ ] 過小評価あり

## 8. 会場・月別

貼り付け:

```text
# report:venue-monthly
```

強い会場:

- 

弱い会場:

- 

月別の偏り:

- 

## 9. 今回の結論

### 採用する改善

- 

### 保留する改善

- 

### 却下する改善

- 

### 次回見ること

- 

## 10. 安全確認

- [ ] 自動投票なし
- [ ] ログイン保存なし
- [ ] 投票サイト操作なし
- [ ] 外部fetchを勝手に実行していない
- [ ] 既存DBを削除していない
- [ ] DROP TABLEしていない

## 11. 実行後コマンド

```bash
pnpm typecheck:scripts
pnpm test
pnpm audit:doctor
pnpm backup:safe
```

## 12. コミット

- commit hash:
- push済み: yes / no
