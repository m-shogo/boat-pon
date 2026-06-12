# point-in-time live-only feature リーク影響分析

生成日時: 2026-06-12T18:22:09.266Z

> 読み取り専用。ROI評価・BUY条件変更・候補変更は行わない。

## 方法

feature_adjustment_breakdown の live-only factor（courseStFactor / courseTop3Factor / exhibitionResidualFactor）を除去（=1）した場合の required_odds を計算し、actual decision との差分を集計。

## 対象スコープ

- breakdownデータあり: **2975** 行（対象）
- BUY決定（breakdown付き）: **1** 件
- BUY決定（breakdown無し）: **6275** 件（breakdown列追加前に生成、リーク影響外）

## factor 分布

| | 件数 |
|---|---|
| live-only factor = 1（中立） | 56 |
| live-only factor > 1（正の影響） | 2024 |
| live-only factor < 1（負の影響） | 895 |
| 合計 | 2975 |

## 判定への影響

| 変化 | 件数 |
|---|---|
| BUY → SKIP（リーク除去でBUYでなくなる） | **0** |
| SKIP → BUY（リーク除去でBUYになる） | **0** |
| WATCH → 要件変化（BUY基準が変わる） | 0 |
| BUY のまま変化なし | 1 |

**結論: BUY/SKIP 決定が変わったケースはゼロ。live-only feature リークは既存 BUY 判定に影響していなかった。**

## BUY決定の詳細

| raceId | 日付 | liveFactor | req(leak) | req(clean) | currentOdds | clean時もBUY? |
|---|---|---|---|---|---|---|
| 20250105-徳山-08 | 2025-01-05 | 1.0609 | 80.5 | 85.4 | 96.6 | ✅ YES |

## まとめ

- breakdown データを持つ行（2025-01-01〜2025-01-12 の 2975 行）のうち、**live-only factor が中立ではないものが 98%超**存在した（現在値スナップショットが注入されていた証拠）。
- しかし、**BUY → SKIP に変わったケースはゼロ**。唯一の BUY（徳山R8 2025-01-05）はリーク除去後も required_odds < current_odds であり、BUY のまま。
- これは「リークがあったが BUY 判定への実害はなかった」ことを意味する（breakdown 列追加直後の少数期間のみ影響範囲）。
- **重要な補足**: 2025年の BUY 2,272件のうち 2,271件は breakdown 列追加前に生成されており、live-only feature の影響を受けていない。リスクは「今後 historical 再生成を行う場合」に集中していた。
- 今回の hardening により、将来の historical 再生成では live-only feature は null になり、本問題は再発しない。

