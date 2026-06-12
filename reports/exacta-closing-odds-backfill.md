# exacta closing odds backfill

生成日時: 2026-06-12T00:40:47.340Z
モード: WRITE

> **BUY は検証候補、ROI は検証指標。購入推奨ではない。**
> **historical closing odds は live/T-5/timeseries odds ではない。**

## 実行サマリ

| 項目 | 値 |
|---|---|
| BUY対象 (全期間) | 14件 |
| 保存済み (exacta) | 4301件 |
| 未取得 | 1件 |
| 今回処理 | 1件 (limit=5) |
| 成功 | 1件 |
| エラー | 0件 |
| F返還レース | 0件 (odds 取得可、払戻検算は構造的不一致) |
| INSERT 行数 | 20行 |

## 処理詳細 (先頭20件)

| race_id | status | cells | 1-2 | 1-3 | 1-4 | F返還 |
|---|---|---|---|---|---|---|
| 20241015-平和島-09 | cached_ok | 20 | — | — | — |  |

---
*生成: backfill-exacta-closing-odds.ts*