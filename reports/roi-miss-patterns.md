# ROI Miss Pattern Analysis

生成: 2026-06-08T05:57:09.653Z / DB: data/boat.sqlite

対象: historical-backfill BUY n=6260 / hits=124 / misses=6136


## 1. 外れ方サマリー

| 外れパターン | 件数 | 外れ中割合 | 説明 |
|---|---:|---:|---|
| HEAD_CORRECT_REVERSED | 128 | 2.09% | 1着正解・2/3着が逆 → REVERSE selectorで的中可能性 |
| TOP3_INCLUDED | 193 | 3.15% | 買い目3艇がTop3に全部入っていた → TOP3_BOX selectorで的中可能性 |
| HEAD_CORRECT_REST_WRONG | 1205 | 19.64% | 1着正解・2/3着が一部外れ → HEAD_FIXED_FLOWで改善余地 |
| FIRST_SECOND_FIXED_WOULD_HIT | 418 | 6.81% | 1着2着正解・3着だけ外れ → 1-2固定3着流しで的中可能性 |
| HEAD_FIXED_WOULD_HIT | 630 | 10.27% | 1着正解・2/3着外れ → 1着固定流しで的中の可能性 |
| COMPLETE_MISS | 3562 | 58.05% | 完全外れ |

## 2. 月別 外れパターン

| 月 | n | hits | hitRate | 最多外れパターン |
|---|---:|---:|---:|---|
| 月1 | 275 | 4 | 1.45% | COMPLETE_MISS |
| 月2 | 385 | 3 | 0.78% | COMPLETE_MISS |
| 月3 | 465 | 5 | 1.08% | COMPLETE_MISS |
| 月4⭐ | 485 | 10 | 2.06% | COMPLETE_MISS |
| 月5 | 702 | 16 | 2.28% | COMPLETE_MISS |
| 月6⭐ | 590 | 13 | 2.20% | COMPLETE_MISS |
| 月7 | 693 | 11 | 1.59% | COMPLETE_MISS |
| 月8⭐ | 701 | 20 | 2.85% | COMPLETE_MISS |
| 月9 | 533 | 10 | 1.88% | COMPLETE_MISS |
| 月10 | 494 | 9 | 1.82% | COMPLETE_MISS |
| 月11 | 559 | 12 | 2.15% | COMPLETE_MISS |
| 月12⭐ | 378 | 11 | 2.91% | COMPLETE_MISS |

## 3. 条件別 外れパターン

| 条件 | n | hits | hitRate | 最多外れパターン |
|---|---:|---:|---:|---|
| isBase条件 | 543 | 26 | 4.79% | COMPLETE_MISS |
| 強月×parts=0 | 2074 | 52 | 2.51% | COMPLETE_MISS |
| 弱月(その他) | 4106 | 70 | 1.70% | COMPLETE_MISS |
| parts=0 | 5939 | 117 | 1.97% | COMPLETE_MISS |
| partsあり | 321 | 7 | 2.18% | COMPLETE_MISS |
| headF=0 | 4121 | 91 | 2.21% | COMPLETE_MISS |
| headFあり | 1938 | 29 | 1.50% | COMPLETE_MISS |

## 4. オッズ帯別 外れパターン

| オッズ帯 | n | hits | hitRate | 最多外れパターン |
|---|---:|---:|---:|---|
| odds<30 | 614 | 18 | 2.93% | COMPLETE_MISS |
| 30-50 | 3846 | 82 | 2.13% | COMPLETE_MISS |
| 50-80 | 1708 | 24 | 1.41% | COMPLETE_MISS |
| >=80 | 92 | 0 | 0.00% | COMPLETE_MISS |

## 5. isBase条件内の外れパターン

| 外れパターン | 件数 | 外れ中割合 |
|---|---:|---:|
| HEAD_CORRECT_REVERSED | 11 | 2.13% |
| TOP3_INCLUDED | 23 | 4.45% |
| HEAD_CORRECT_REST_WRONG | 96 | 18.57% |
| FIRST_SECOND_FIXED_WOULD_HIT | 26 | 5.03% |
| HEAD_FIXED_WOULD_HIT | 50 | 9.67% |
| COMPLETE_MISS | 311 | 60.15% |

## 6. 買い方Selector シミュレーション

> **⚠️ 注意**: 常時BOXや常時FLOWは危険候補です。点数増加分をROI改善が上回る場合のみ部分適用を検討してください。

| Selector | 点数/R | hits | hitRate | ROI | roiExMaxHit | maxHit | 評価 |
|---|---:|---:|---:|---:|---:|---:|---|
| SINGLE | 1 | 124 | 1.98% | 80.38% | 79.14% | 77.70 | △ WATCH |
| REVERSE | 2 | 184 | 2.94% | 74.61% | 73.25% | 170.10 | ⚠️ DANGEROUS |
| TOP3_BOX | 6 | 445 | 7.11% | 69.61% | 68.54% | 399.10 | ⚠️ DANGEROUS |
| HEAD_FIXED_FLOW | 10 | 2505 | 40.02% | 140.14% | 138.91% | 773.30 | ⚠️ DANGEROUS |
| FIRST_SECOND_FIXED_FLOW | 4 | 542 | 8.66% | 72.67% | 71.52% | 289.00 | ❌ NO_BUY |

**Selectorの解説:**

- **SINGLE**: 現在の1点買い (baseline)
  警告: baseline

- **REVERSE**: 1-2着入れ替え 2点買い (点数2倍)
  警告: 点数2倍注意: コスト増加分をROI改善が上回るか要確認

- **TOP3_BOX**: 3艇BOX 6点買い (⚠️常時BOXは危険候補)
  警告: ⚠️ 点数6倍: 常時BOX適用は危険候補。ROI改善が大幅でなければ不採用

- **HEAD_FIXED_FLOW**: 1着固定 2/3着流し 10点買い (⚠️常時FLOWは危険候補)
  警告: ⚠️ 点数10倍: 常時採用不可 (全レース適用禁止)。特定条件に絞った部分適用のみ要検討

- **FIRST_SECOND_FIXED_FLOW**: 1-2着固定 3着流し 4点買い
  警告: 点数4倍: 1-2着正解率に依存。改善幅要確認

## 7. 買い方Selector 推奨

- HEAD_FIXED_FLOW: 外れのうち31.99%が1着正解 → **常時採用不可** (点数10倍: 全レース一律適用は禁止)。特定条件を絞った部分検討のみ
- REVERSE: ROI 5.76% 悪化 → 不採用推奨
- TOP3_BOX: ROI 10.77% 悪化 → 不採用推奨
- HEAD_FIXED_FLOW: ROI 59.76% 改善 (80.38% → 140.14%), 点数10倍
- FIRST_SECOND_FIXED_FLOW: ROI 7.71% 悪化 → 不採用推奨

- ⚠️ 常時BOX/常時FLOWは危険候補: 全レースに適用すると期待値が下がるリスクあり。
- 条件を絞った上での部分適用のみ検討してください。

---
*生成: 2026-06-08T05:57:09.653Z / DB: data/boat.sqlite*