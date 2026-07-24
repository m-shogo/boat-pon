# N1-A local official archive audit

更新: 2026-07-24  
scope: `data/raw/official/results/k*.lzh`全件  
外部request: 0

| 項目 | 実測 |
|---|---:|
| archive | 8,164 |
| parse成功 / 失敗 | 8,164 / 0 |
| 範囲 | `k000101.lzh`〜`k260722.lzh` |
| race records | 1,194,007 |
| payout lines | 11,514,006 |
| modern seven-display | 8,030 |
| legacy pre-trifecta | 134 |
| unknown schema | 0 |

券種別lineはwin 1,125,870、place 2,161,438、exacta 1,189,688、quinella 1,180,976、wide 3,508,840、trifecta 1,174,202、trio 1,172,992。公式rawには単勝・複勝が存在し、複勝と拡連複の複数lineもhistoricalに再構築可能だった。

このdry-runはraw保存や永続sidecarへのcandidate保存を行わない。結果は[`n1-all-bet-type-payout-archive-audit.json`](n1-all-bet-type-payout-archive-audit.json)を機械可読正本とする。
