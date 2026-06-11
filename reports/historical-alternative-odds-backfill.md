# historical closing odds backfill dry-run

生成日時: 2026-06-11T01:52:33.542Z
モード: **⚠️ --write (DB INSERT実行)**
優先順位: `skip6R` (6R)

> **historical closing odds は live/T-5/timeseries odds ではありません。**
> **公式アーカイブから後日取得した「締切時オッズ backfill」です。**
> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。

---

## only-missing=true の動作仕様

| 項目 | 値 |
|---|---|
| only-missing | true (デフォルト: true) |
| 既保存済み race 数 | 347 件 (スキップ) |
| 既保存済みレコード数 | 1732 件 |
| 今回の対象 race 数 | 12 件 (= 次の未保存分) |

> **⚠️ 仕様注意**: `only-missing=true` は **resume（再開）動作** です。
> - 同じコマンドを再実行すると、**既存 race をスキップ**して次の未保存 race へ進みます
> - 「同じ30件で重複確認（べき等確認）」にはなりません
> - 重複防止は **unique制約 + INSERT OR IGNORE** が担保しています（race 単位ではなく record 単位）
> - べき等確認が必要な場合は `--no-only-missing` で実行してください（同一 race に対し IGNORE が正常動作するか確認できます）

---

## 実行結果サマリ

| 項目 | 件数 | 率 |
|---|---:|---:|
| 対象レース | 12 | — |
| キャッシュ利用 | 12 | — |
| fetch 成功 | 12 | 100% |
| parse 成功 | 12 | 100% |
| 5買い目全取得 | 12 | 100% |
| 1-3-2≠1-2-3（別値） | 12 | 100% |
| 5買い目全て別値 | 12 | 100% |
| 保存予定レコード数 | 60 | — |
| INSERT 完了レース | 12 | — |

### 1-2-3 odds vs current_odds 乖離

| 平均乖離 | 最大乖離 |
|---:|---:|
| 0pt | 0pt |

> 乖離は current_odds（取得タイミング前後）と closing odds（締切直後）の差。
> 大きい乖離は「締切前後でオッズが動いた」ことを示す（即バグではない）。

---

## 品質判定

| 項目 | 結果 |
|---|---|
| fetch成功率 ≥ 95% | ✅ OK (100%) |
| 5買い目全取得率 ≥ 95% | ✅ OK (100%) |
| 1-3-2別値率 | ✅ OK (100%) |
| 全体品質 | ✅ 良好 |
| 次に --write してよいか | 実行済み |

---

## 全レース詳細

| race_id | fetch | parse | all5 | 1-3-2別値 | 乖離 | 保存予定 | notes |
|---|:---:|:---:|:---:|:---:|---:|---:|---|
| 20250210-若松-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250209-住之江-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250209-若松-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250207-芦屋-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250206-若松-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250204-若松-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250203-びわこ-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250203-平和島-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250201-下関-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250201-住之江-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250201-尼崎-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |
| 20250201-鳴門-06 | ✅ | ✅ | ✅ | ✅ | 0pt | 5件 | — |

---

## 保存予定レコードサンプル（最大3件）

| race_id | combination | odds | source_quality | source_url |
|---|---|---:|---|---|
| 20250210-若松-06 | 1-2-3 | 55.2 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250210 |
| 20250210-若松-06 | 1-3-2 | 71.4 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250210 |
| 20250210-若松-06 | 1-2-4 | 139.9 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250210 |
| 20250210-若松-06 | 1-4-2 | 260.3 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250210 |
| 20250210-若松-06 | 1-3-4 | 82.7 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250210 |
| 20250209-住之江-06 | 1-2-3 | 42.9 | historical_closing_odds | ...odds3t?rno=6&jcd=12&hd=20250209 |
| 20250209-住之江-06 | 1-3-2 | 23.2 | historical_closing_odds | ...odds3t?rno=6&jcd=12&hd=20250209 |
| 20250209-住之江-06 | 1-2-4 | 159.1 | historical_closing_odds | ...odds3t?rno=6&jcd=12&hd=20250209 |
| 20250209-住之江-06 | 1-4-2 | 278.9 | historical_closing_odds | ...odds3t?rno=6&jcd=12&hd=20250209 |
| 20250209-住之江-06 | 1-3-4 | 43 | historical_closing_odds | ...odds3t?rno=6&jcd=12&hd=20250209 |
| 20250209-若松-06 | 1-2-3 | 42 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250209 |
| 20250209-若松-06 | 1-3-2 | 44.2 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250209 |
| 20250209-若松-06 | 1-2-4 | 25 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250209 |
| 20250209-若松-06 | 1-4-2 | 24.5 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250209 |
| 20250209-若松-06 | 1-3-4 | 19.1 | historical_closing_odds | ...odds3t?rno=6&jcd=20&hd=20250209 |

---

## 注記

- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない
- 事前代替 odds 不足のため switch 本採用不可
- **historical closing odds backfill ができても live/T-5 forward ではない**
- 現時点で採用可能なのは skip monitor のみ
- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可
- switch は必ず future-only odds_timeseries で再確認する

---
*生成: backfill-historical-alternative-odds.ts / mode=write / priority=skip6R*