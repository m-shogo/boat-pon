# Settlement reparse Before / After（temp-copy 実測・実適用は未承認）

> 出典: `reports/n2/settlement-reparse-full.json`（digest 247310fbd8bc40db54568b0d0d3e84d823fd3da1a551c192cad2ff775a9a090f）。source SHA-256 d9b5ddd264ea138f… 不変・write 0。production apply は BLOCKED。

| 指標 | Before | After | 差分 |
|---|---:|---:|---:|
| active refunded | 319,301 | 1,554 | -317,747 |
| active settled | 7,833,297 | 8,216,200 | +382,903 |
| active partially_refunded | 1 | 1 | +0 |
| logical active total | 8,152,599 | 8,217,755 | +65,156 |
| physical rows | 8,156,795 | 8,539,698 | +382,903 |
| false refund（active） | 319,301 | 1,554（真の返還） | -317,747 |
| special payout additions | 0 | 65,156 | +65,156 |
| eligible率（settled/active・概算） | 約96.08% | 約99.98% | +約3.90pt |

- false_refund_correction **317,747** / special_payout_addition **65,156** / held-out(manual review) **2**（CONFIRMED_V1_WIN_REFUND_OMISSION）
- second-run appended 0（idempotent）/ integrity {"integrityCheck":"ok","foreignKeyViolations":0,"orphanPayoutLines":0,"orphanRefundLines":0,"ambiguousActiveKeys":0}

## 実レース例

| 種別 | race | 会場 | 券種 | Before | After | 根拠 ／ model label 影響 |
|---|---|---|---|---|---|---|
| false_refund_correction | 2000-01-01 R2 | 下関 | quinella | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[5-6:560] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| false_refund_correction | 2000-01-01 R6 | 下関 | exacta | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[4-6:1660] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| false_refund_correction | 2000-01-01 R6 | 下関 | place | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[4:190, 6:240] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| false_refund_correction | 2000-01-02 R1 | 下関 | place | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[4:260] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| false_refund_correction | 2000-01-02 R1 | 下関 | quinella | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[4-5:680] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| false_refund_correction | 2000-01-02 R10 | 下関 | exacta | refunded（v1 返還: refundYenPer100=100) | settled/normal payout=[2-1:1240] | v1 が特払いを race-wide 返還化した偽返還。v2 は正常払戻へ復帰し settled。 ／ 返還除外から復帰し hit/loss label が eligible 化 |
| special_payout_addition | 2000-01-01 R2 | 下関 | place | (v1 candidate なし) | settled/special_payout payout=[特払:70(特)] | v1 が抑止した特払いを v2 が券種別 special_payout candidate として顕在化。 ／ special_payout outcome（hit=null, 特払額を financial target に保持） |
| special_payout_addition | 2000-01-01 R6 | 下関 | win | (v1 candidate なし) | settled/special_payout payout=[特払:70(特)] | v1 が抑止した特払いを v2 が券種別 special_payout candidate として顕在化。 ／ special_payout outcome（hit=null, 特払額を financial target に保持） |
| special_payout_addition | 2000-01-02 R1 | 下関 | win | (v1 candidate なし) | settled/special_payout payout=[特払:70(特)] | v1 が抑止した特払いを v2 が券種別 special_payout candidate として顕在化。 ／ special_payout outcome（hit=null, 特払額を financial target に保持） |
| genuine_refund_maintained | 2024-01-03 R5 | 常滑 | exacta | refunded（v1 返還: refundYenPer100=100) | refunded refund=[selection:100] | v1/v2 とも返還。真の返還として維持（訂正しない）。 ／ eligible=false（返還）を維持 |
| held_out:CONFIRMED_V1_WIN_REFUND_OMISSION | 2014-03-28 R1 | 常滑 | win | (v1 candidate なし) | refunded refund=[selection:100] | 本 special-payout reparse の scope 外（v1 win 返還欠落）。auto-apply せず手動レビュー。 ／ 本 reparse では変更なし（別承認の別訂正で扱う） |
| held_out:CONFIRMED_V1_WIN_REFUND_OMISSION | 2014-03-28 R2 | 宮島 | win | (v1 candidate なし) | refunded refund=[selection:100] | 本 special-payout reparse の scope 外（v1 win 返還欠落）。auto-apply せず手動レビュー。 ／ 本 reparse では変更なし（別承認の別訂正で扱う） |

> Before は full report の correctionSamples（status-level）、After は archive の v2 再parse。実適用は未承認。
