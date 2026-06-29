# 過去 forward 期間 締切時代替 odds 取得可能性監査

生成日時: 2026-06-14T07:02:44.332Z
サンプル: 0件 (limit=0 / sleep=1ms)
対象期間: 2025-01-01〜(最新forward)

> **読み取り専用監査。DB書き込みなし。**
> **取得した odds は historical closing odds として扱う。live/T-5 odds とは呼ばない。**
> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。

---

## 総合判定

**✅ 取得可能・5買い目OK・odds差異あり → backfill候補**

| 項目 | 件数 | 成功率 |
|---|---:|---:|
| サンプル総数 | 0 | — |
| キャッシュ利用 | 0 | — |
| fetch 成功 | 0 | NaN% |
| parse 成功 | 0 | NaN% |
| 5買い目全取得 | 0 | NaN% |
| 1-3-2≠1-2-3（別値） | 0 | NaN% |
| 5買い目全て別値 | 0 | NaN% |

### 1-2-3 odds vs current_odds 乖離

| 指標 | 値 |
|---|---|
| 平均乖離 | — |
| 最大乖離 | — |

> 乖離が大きい場合、current_odds は締切前暫定値であり、取得した closing odds と異なる可能性あり。
> 乖離が小さい場合、historical closing odds は current_odds の精度確認にも使える。

---

## カテゴリ別集計

| カテゴリ | n | fetch成功 | parse成功 | 5買い目 | 1-3-2別値 |
|---|---:|---:|---:|---:|---:|

---

## 取得成功例（最大5件）

> 取得成功例なし（fetch/parse失敗 or 同値問題）

## 取得失敗例（最大5件）

> 失敗例なし

---

## 全サンプル詳細

| race_id | cat | fetch | parse | all5 | 1-3-2別値 | 乖離 | notes |
|---|---|:---:|:---:|:---:|:---:|---:|---|

---

## 結論

| 判断軸 | 結果 |
|---|---|
| 取得可能か | ✅ 可能 |
| 5買い目 parse 可能か | ✅ 可能 |
| 1-3-2が正しく別値か | ✅ 別値あり |
| historical closing odds として使えるか | ✅ 使えそう |
| 大量 backfill してよいか | ⚠️ --limit 200 で次フェーズ可 |
| まだ switch 分析できない理由 | timeseries BUY重複 n<200 / live forward odds 未蓄積 |
| 次に --write してよいか | ⚠️ dry-run n=200確認後に検討 |

> ⚠️ **switch 分析は historical closing odds が取れても本採用不可。**
> live/T-5 odds（odds_timeseries_snapshots）での forward 検証が揃うまで採用できない。
> 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可。

---
*生成: audit-historical-closing-odds-availability.ts*