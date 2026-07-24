# N1-A Legacy reconciliation

更新: 2026-07-24  
scope: sanitized K fixture vs `data/boat.sqlite.race_payouts`  
DB mode: read-only  
自動修正: なし

| 分類 | line |
|---|---:|
| 比較 | 1,440 |
| exact match | 720 |
| N1 only | 720 |
| Legacy only | 0 |
| payout mismatch | 0 |

既存保存済み5券種の主lineは、exacta / quinella / wide / trifecta / trio各144件、合計720件が完全一致した。N1 onlyはwin 144、place 288、wideの2本目・3本目288である。既存parser/Legacy tableが拡連複の先頭lineだけを保存していたことが分かった。

差分をLegacyへbackfillせず、N1側のraw evidence・複数line・source revision設計の要件として記録する。詳細は[`n1-all-bet-type-payout-reconciliation.json`](n1-all-bet-type-payout-reconciliation.json)を正本とする。
