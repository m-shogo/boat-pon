# 期待値モデル改善ロードマップ

最終更新: 2026-05-25 (セッション4)

Boat Pon は自動購入アプリではない。目的は、ほとんどの日を見送り、数字的に割に合う可能性がある時だけ公式確認へ進むこと。

失敗・学びの蓄積は `docs/lessons-learned.md` に残す。重い作業の前には、このロードマップと失敗ログを確認する。

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

## 2026-05-24 の分析結果サマリー（セッション3最終版）

### v3-alpha15 モデルの実績（2025年全期間、BUY n=2,088）

| オッズ帯 | n | 的中 | ROI | 推定的中率 | 実測的中率 | 過大倍率 |
|---------|---|------|-----|-----------|-----------|---------|
| 20〜30倍 | 168 | 7 | 1.097 | 4.99% | 4.17% | 1.2x ← 良好 |
| 30〜50倍 | 1,288 | 25 | 0.754 | 4.10% | 1.94% | 2.1x ← 問題 |
| 50〜100倍 | 631 | 10 | 0.920 | 3.36% | 1.58% | 2.1x ← 問題 |
| **全体** | **2,088** | **42** | **0.835** | | | |

**alpha=15 の効果**: alpha=1 時代（v2: 全帯 3.7倍過大推定）から 20-30倍帯はほぼ解消。30倍以上はまだ2倍の過大推定が残る。

### 試みたフィルターの月別評価（n不足で採用不可）

以下はすべてバックテスト内での最適化であり、月次 n=30〜130 では分散が大きすぎて統計的有意差がない:

| フィルター | n | ROI | 月別 0.0 月数 | 判定 |
|-----------|---|-----|--------------|------|
| 全BUY | 2,088 | 0.835 | 3/11 | 現状 |
| 30-50倍除外 | 800 | 0.964 | 2/11 | 過学習リスク |
| ratio1.5-2.0x | 649 | 0.840 | 5/11 | 採用不可 |
| 可変blendWeight | 353 | ~1.05 | 4/11 | 採用不可 |

### 現在の実装（採用済み）

- **app_settings: maxOddsRatio=2.0**（ratio>2.0のBUYを除外）
- **model_version: boatpon-v3-alpha15**（DEFAULT_MODEL_ALPHA=15）
- **BudgetRule**: maxOdds, maxOddsRatio, minOddsRatio, marketBlendWeight フィールド実装済み（未設定）
- **BudgetRule**: calibrationMode, calibrationBasis, oddsCalibrationFactors 実装済み（デフォルトnone、v3-empiricalで必要オッズ帯または取得オッズ帯別補正）
- **BudgetRule**: programFilter 実装済み（1着候補艇の級別、モーター2連率、ボート2連率でBUY対象を絞れる）
- **BudgetRule**: minRequiredOdds, maxRequiredOdds 実装済み（必要オッズ帯フィルター。2023年外部検証待ち）
- **BudgetRule**: excludedVenues 実装済み（会場除外。難水面会場の系統的ROI低下対策。2023年外部検証待ち）

### 根本課題

30-50倍帯の主な構成は 1-2-3 selection（n=1,243/1,288）。この帯の実測的中率 2.01% に対してモデル推定 4.13%。原因はチェリーピッキングバイアス（会場ごとに最良セレクションを選ぶ際に期待値が過大になる）がまだ alpha=15 でも 30 倍超では残ること。根本修正には 2024 年以前のデータ拡充が必要。

### 旧セッション2の記録（参照用）

以下は v2モデル時代（alpha=1）の数字:
- BUY: 684件, 的中12件（1.75%）, ROI 0.511
- 全帯 calibration 3.7倍過大推定

## 次にデータ待ちのもの

- 過去オッズ補完
  - ✅ 2025年全月 odds_snapshots 17,123件（セッション3完了時点）
  - ✅ 2025-01〜11 の decision_history（v3-alpha15）: BUY 2,443件、WATCH 1,420件、SKIP 23,839件（再生成済み）
  - ✅ 2024-01〜12 の decision_history（v3-alpha15）: BUY 3,957件、WATCH 1,947件、SKIP 49,795件（再生成済み）
  - ✅ BUY/WATCH はオッズ取得率ほぼ100%
  - ✅ kyotei24パーサー: 欠場レースの異常オッズ(MAX_VALID_ODDS=1000)修正済み
  - ✅ marketBlendWeight 実装済み（BudgetRule、デフォルト0）
  - ✅ maxOddsRatio=2.0 を app_settings に設定済み（ライブ適用中）
  - ✅ programFilter (A2×motor<40%) 実装済みだが実測ROI悪化のため不採用（DB設定なし）
  - **バックフィルはほぼ完了。次の優先事項: 2023年以前のデータ取得**
  - 残: calibration 30-50倍帯の 2.1x 過大推定（cherry-picking バイアス）
  - 注意: programFilter 等の設定変更評価は --refresh-existing ではなく DELETE + 再生成で行う
  - **セッション4発見: B1+25-30帯フィルターが両年ROI>1.17（全件1-2-3・B1の1号艇・市場がB1を過小評価）**
  - **セッション4発見: 難水面5会場（戸田・多摩川・桐生・三国・江戸川）が系統的にROI<0.5**
- 天候/風波/安定板/周回短縮の実データ紐づけ
- 返還/欠場/展示異常のBUY抑制
- 番組カテゴリ別に targetEv/minSampleSize を変える検証
- **優先度高: 2024年データで calibration 検証を拡充する**（月次 n が少なすぎてフィルター効果が判断不能）

## 採用ルール

- ROIだけで採用しない
- BUY数が少なすぎる条件は過学習扱い
- 月別ROIが極端にブレる条件は保留
- オッズ未取得のBUYは採用しない
- 「買わない日が増える」改善は成功として扱う
- 採用/保留/却下の判断は `docs/lessons-learned.md` の採用判定テンプレで記録する

## 進め方

1. 小さい期間で仮説を作る。
2. 先にデータ整合性、ROI定義、重複行、旧モデル混入を直す。
3. 重い取得や全期間再生成は、その後に実行する。
4. 条件探索は、探索した期間と検証する期間を分ける。
5. 採用判断は、総ROI、月別、会場別、オッズ帯別、BUY数をセットで見る。

## 重い作業前に必ず確認すること

- `git status --short` で未コミット差分を確認する。
- `data/boat.sqlite` への書き込みを並行実行しない。
- `fetch:official-results`, `fetch:official-programs`, `fetch:kyotei24` は明示承認なしに実行しない。
- `data/raw/official` は触らない。
- ROIは `payout_yen` ではなく `current_odds` ベースで確認する。
- `generate:history` 後は同一 `race_id` 重複と旧モデルBUYの残りを確認する。

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
