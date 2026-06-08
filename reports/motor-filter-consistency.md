# motor filter consistency

## 結論
- `featureAdjustment` は `venueMotorTop2Rate ?? motorTop2Rate` を使う一方、`programFilter.maxMotorTop2Rate` は現状 `candidateMotorTop2Rate` / `firstBoatFeature.motorTop2Rate` 側に寄っており、venue値を見ていない疑いがあります。
- まず本番変更ではなく、venue基準/national基準/両方基準のA/B再生成で確認すべきです。

| condition | n | hit率 | avg odds | ROI | 削除候補か | コメント |
|---|---:|---:|---:|---:|---|---|
| national motorTop2Rate >= 50 | 246 | 0.41% | 41.768 | 0.172 | 候補 | national基準も弱いが、venueとのズレ確認が必要 |
| venueMotorTop2Rate >= 50 | 143 | 0.70% | 47.200 | 0.299 | 候補 | venue基準のNO BUY/減点候補 |
| both >= 50 | 49 | 0.00% | 45.141 | 0.000 | 観察 | n不足。採用不可 |
| nationalのみ >= 50 | 197 | 0.51% | 40.929 | 0.215 | 候補 | national基準も弱いが、venueとのズレ確認が必要 |
| venueのみ >= 50 | 94 | 1.06% | 48.273 | 0.455 | 候補 | venue基準のNO BUY/減点候補 |
| 両方 < 50 | 5920 | 2.06% | 44.388 | 0.836 | 観察 | 観察 |
| venueMotor missing | 47 | 4.26% | 35.796 | 0.700 | 観察 | n不足。採用不可 |

## 修正案
- 案A: filterもvenue優先に統一する。ただし過学習検証後。
- 案B: `maxMotorTop2Rate` は即除外ではなくscore減点にする。
- 案C: national>=50かつvenue>=50 の両方一致時だけ強いNO BUYにする。
