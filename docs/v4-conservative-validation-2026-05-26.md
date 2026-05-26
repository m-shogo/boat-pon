# v4 conservative validation 2026-05-26

目的: v4 conservative を `decision_history` に書き込まず、既存DBの `official_programs` / `race_results` / `odds_snapshots` だけで読み取り評価する。

## 実行条件

- 実行日時: 2026-05-26 20:48 JST
- DB: `data/boat.sqlite`
- 書き込み: なし
- 評価ROI: `current_odds` 基準
- モデル: `DEFAULT_APP_RULE`、学習窓180日

## 小期間チェック

```sh
npm run evaluate:v4 -- --from 2025-01-01 --to 2025-01-31 --limit 500
```

結果:

- races=500
- modeled=500
- BUY=10
- WATCH=30
- SKIP=460
- hits=0
- ROI=0.000
- avgRequiredOdds=47.751
- avgCurrentOdds=21.900
- avgOddsRatio=0.453
- avg conservative discount=16.8%

この期間ではBUY数が少なく、的中なし。スクリプト動作確認としては有効だが、採用判断には使わない。

## 2025年読み取り評価

```sh
npm run evaluate:v4 -- --from 2025-01-01 --to 2025-11-30 --limit 50000
```

全体:

- races=49416
- modeled=49416
- BUY=353
- WATCH=1043
- SKIP=48020
- hits=5
- ROI=0.788
- ROI excluding max hit=0.604
- avgRequiredOdds=47.953
- avgCurrentOdds=22.355
- avgOddsRatio=0.468
- avg conservative discount=16.6%

月別:

| 月 | races | BUY | hits | ROI |
| --- | ---: | ---: | ---: | ---: |
| 2025-01 | 5093 | 35 | 1 | 1.824 |
| 2025-02 | 4472 | 21 | 0 | 0.000 |
| 2025-03 | 4637 | 26 | 0 | 0.000 |
| 2025-04 | 4218 | 37 | 1 | 1.630 |
| 2025-05 | 5081 | 42 | 0 | 0.000 |
| 2025-06 | 4770 | 42 | 1 | 1.095 |
| 2025-07 | 5165 | 43 | 0 | 0.000 |
| 2025-08 | 5057 | 45 | 0 | 0.000 |
| 2025-09 | 4242 | 21 | 0 | 0.000 |
| 2025-10 | 4121 | 20 | 1 | 2.215 |
| 2025-11 | 2560 | 21 | 1 | 3.076 |

required odds帯:

| required odds | races | BUY | hits | ROI |
| --- | ---: | ---: | ---: | ---: |
| 25-30 | 93 | 0 | 0 | - |
| 30-40 | 9251 | 40 | 1 | 1.107 |
| 40-50 | 23598 | 210 | 2 | 0.506 |
| 50-70 | 14897 | 87 | 2 | 1.472 |
| 70-100 | 1577 | 16 | 0 | 0.000 |

odds ratio帯:

| odds ratio | races | BUY | hits | ROI |
| --- | ---: | ---: | ---: | ---: |
| <1.0 | 17247 | 0 | 0 | - |
| 1.0-1.2 | 549 | 186 | 3 | 0.823 |
| 1.2-1.5 | 452 | 167 | 2 | 0.748 |
| 1.5-2.0 | 393 | 0 | 0 | - |
| 2.0+ | 401 | 0 | 0 | - |
| 不明 | 30374 | 0 | 0 | - |

className別:

| className | races | BUY | hits | ROI |
| --- | ---: | ---: | ---: | ---: |
| A1 | 15946 | 0 | 0 | - |
| A2 | 13588 | 0 | 0 | - |
| B1 | 18737 | 353 | 5 | 0.788 |
| B2 | 1093 | 0 | 0 | - |
| 不明 | 52 | 0 | 0 | - |

## 参考比較

同期間の既存 `decision_history` は参考値としてのみ扱う。v3/v4を混ぜたROIは出さない。

- `boatpon-v3-alpha15`: BUY=2443, hits=50, ROI=0.867
- `boatpon-v2-regime-category`: SKIPのみ

## 判断

v4 conservative は、B1絞り込みと保守化によりBUY件数はかなり絞れている。一方で、2025年読み取り評価ではROI 1.0未満で、最大的中依存を除くとさらに悪化する。月別では勝ち月があるが、0.000の月が多く、安定性は足りない。

現時点で live BUY 採用へ進める根拠は弱い。次は「BUYを増やす調整」ではなく、損失月と不的中BUYの構造を先に分解する。特に `required_odds=40-50` と `odds_ratio=1.2-1.5` のBUYが弱く、ここを安易に緩めない。
