# 期待値モデル改善ロードマップ

最終更新: 2026-05-24

Boat Pon は自動購入アプリではない。目的は、ほとんどの日を見送り、数字的に割に合う可能性がある時だけ公式確認へ進むこと。

## 現在入っているもの

- プロペラ制度レジーム分離
  - 2012-05-01以降を現代モデルの主対象にする
  - 2012年4月の移行期は現代予測から外す
- 会場別/艇番別の観測頻度モデル
- Laplaceスムージング
- 番組カテゴリ推定
  - SG, PG1, G1, G2, G3, 一般, 女子, ルーキー, 匠, 進入固定, 優勝戦, 準優勝戦, 企画
- 番組表特徴量による保守的補正
  - 1着艇の級別、全国勝率、当地勝率、モーター2率、ボート2率
- 月次ドリフト監視
- モデル比較API/UI
- オッズ履歴保存テーブル

## 2026-05-24 の分析結果サマリー

以下は `docs/odds-quality-report-2026-05-24.md` の要点。

- BUY: 430件, 的中12件（2.79%), ROI 0.825（損失圏）
- 推定的中率6.36% vs 実測2.79% → **calibration 2.28倍過大**
- 最良のオッズ帯: **20〜50倍（ROI 0.995）**
- 最良のEV帯: **2.0〜3.0（ROI 1.785）**
- オッズ50倍以上: ROI 0.473（損失大）
- EV 3.0以上: ROI 0.000（全件ミス）

### 暫定BUY絞り込み条件（検証中）

```
currentOdds < 50倍 かつ EV 2.0〜3.0
```

実績: n=103, ROI 1.670（サンプル不足につき採用不可）

## 次にデータ待ちのもの

- 過去オッズ補完
  - ✅ 2025年全月のBUY/WATCHは100%取得済み
  - 残: 2025年の残り月（01〜07）の decision_history 作成
  - 残: calibration 係数の実測値への調整
- 天候/風波/安定板/周回短縮の実データ紐づけ
- 返還/欠場/展示異常のBUY抑制
- 番組カテゴリ別に targetEv/minSampleSize を変える検証

## 採用ルール

- ROIだけで採用しない
- BUY数が少なすぎる条件は過学習扱い
- 月別ROIが極端にブレる条件は保留
- オッズ未取得のBUYは採用しない
- 「買わない日が増える」改善は成功として扱う

## 見るべき画面

1. Backtest > モデル比較
2. Dashboard > モデル監視
3. Dashboard > 番組カテゴリ別ROI
4. Dashboard > 会場別ROIヒートマップ
5. Backtest > 時系列検証

## 判定履歴の増やし方

外部取得なしで、保存済みの公式番組表と結果からウォークフォワード判定履歴を作れる。
補完対象を増やす時は、まず短い期間・少ない件数で dry-run する。

```bash
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100 --include-required-odds-candidates
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100 --refresh-existing --include-skips
```

- `--from`, `--to`, `--limit` は必須。
- 学習期間はデフォルトで対象開始日の180日前から。変える場合は `--train-days 365` のように指定する。
- デフォルトでは BUY/WATCH のみ保存し、SKIPは保存しない。
- `--include-skips` を付けた時だけSKIPも保存する。
- `--include-required-odds-candidates` を付けると、オッズ未取得でも必要オッズ80倍以下の候補を保存対象にできる。
- 同じ期間を再実行しても、同じ `raceId + selection` の履歴は重複保存しない。
- `--refresh-existing` を付けると、補完済みオッズを使って既存履歴の `currentOdds / EV / decision` を再計算する。
- 外部サイトにはアクセスしない。
