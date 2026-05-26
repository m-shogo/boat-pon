# 期待値モデル改善ロードマップ

最終更新: 2026-05-26 (セッション12)

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
- **BudgetRule**: minRequiredOdds=25 設定済み（外部検証でreq>=30は逆効果確認、req>=25を維持）
- **BudgetRule**: excludedVenues 設定済み（戸田・多摩川・桐生・三国・江戸川の5会場除外、外部検証済み）
- **BudgetRule**: classOddsRatioRules 設定済み（B1 maxOddsRatio=1.5。A2は外部検証ROI=0.63で不採用）
- **programFilter**: allowedClassNames=["B1"]・excludeSameClassSecondBoat=true・minFirstBoatNationalWinRate=4.0 設定済み
- ✅ Calibration分析UI追加（/api/backtest/calibration + CalibrationPanel: req帯×クラス別 calib_ratio）

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
  - ✅ バックフィル完了: 2022全年・2023全年 odds_snapshots（2020/2021はkyotei24に7月以前データなし、限界）
  - ✅ 2022/2023外部検証完了（セッション9): B1(ratio<1.5) 外部合算ROI=0.739（ランダムベット水準）、A2(ratio>=1.5) ROI=0.630
  - ✅ A2をallowedClassNamesから除外済み（外部検証 ROI=0.63で閾値0.70未満）
  - ✅ Calibration API/UI追加（/api/backtest/calibration）: req帯×クラス別 calib_ratio 表示
  - ✅ daily-brushupにbuyModelVersionDrift・decisionRuleGrid追加
  - 残: calibration 30-50倍帯の 2.1x 過大推定（cherry-picking バイアス）
  - B1外部検証結果: 真のROI≒0.74（Codex推定0.73と一致）、ライブ継続は最小額/paper扱い
  - 注意: programFilter 等の設定変更評価は --refresh-existing ではなく DELETE + 再生成で行う
  - **セッション4発見: B1+25-30帯フィルターが両年ROI>1.17（全件1-2-3・B1の1号艇・市場がB1を過小評価）**
  - **セッション4発見: 難水面5会場（戸田・多摩川・桐生・三国・江戸川）が系統的にROI<0.5**
  - **セッション5発見: odds_ratio≥1.7はB1+25-30帯内でも系統的に悪い（188件で1的中・0.53% 実測 vs 4.5% 推定）。全BUYでも1.7-2.0x帯ROI=0.672。市場が大幅に高オッズを付けるとき、市場が正しい傾向**
  - **セッション5発見: B1+25-30+ratio<1.7+三国除外の組合せは2024=1.454, 2025=1.504でhit率4.13%両年一致。ただし3層最適化のため2023年外部検証前に採用不可**
  - **セッション5追加発見(重要): 2号艇クラス≠1号艇クラスが全req_odds帯で一貫してROI改善。B1全帯+2号艇≠B1: 2024=1.194, 2025=1.081。B1+25-30+2号艇≠B1: 2024=1.406, 2025=1.643。全帯で「2号艇≠B1」が「2号艇=B1」を上回るため、req_odds帯に依存しない汎用シグナル**
  - **実装済み: programFilter.excludedSecondBoatClassNames, BetCandidate.secondBoatFeature/thirdBoatFeature**
  - **セッション5最終: 月別安定性検証完了。B1全帯+2号艇≠B1 がゼロ月率8.7%(1/23月)で最安定。B1+25-30は12.5%(2/16月)。B1+25-30+2号≠B1は26.7%(4/15月)でROI高いが月別不安定**
  - **3号艇クラス追加フィルターは不採用: A2除外でROI+0.054のみ・3層最適化リスク大**
  - **外部検証優先度: (1)B1全帯+2号艇≠B1 → (2)B1+25-30 → (3)B1+25-30+2号≠B1 の順**
  - **セッション6発見: B1全帯+2号艇≠B1内でも難水面5会場は330件2的中(ROI=0.314)。多摩川・戸田・江戸川は完全0的中。5会場除外後: 2024=1.401(n=703), 2025=1.323(n=444)。両条件独立した理論根拠あり → 外部検証第一候補**
  - **❌ セッション12: 2号艇≠B1 外部検証(2020-2023)で否定 → 撤回済み（2026-05-26）**
    - 外部 ROI: 2号艇≠B1=0.786 vs 2号艇=B1=1.063 vs 全体=0.944（方向逆転）
    - 2024-2025の高ROIは年22件以下の少数ヒットの偶然と判定
    - `excludeSameClassSecondBoat=false` に変更済み
    - B1フィルター本体（5会場除外+req>=25+ratio<1.5）は外部ROI=0.944で有効 → 維持
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

## 2026 ライブ監視フレーム（固定しきい値）

2026-01-01以降の `model_version=boatpon-v3-alpha15` BUYを「完全未使用データ」として外部検証と分離して蓄積する。

### 現在の状態（2026-05-26）

- 2026年 v3-alpha15 BUY: **n=0**（まだ蓄積なし）
- ライブ蓄積ペース目安: 月24件（2024-2025実績から）
- 監視UI: Backtest > 2026ライブ監視パネル（`/api/live/b1-monitor`）

### 採用・撤退しきい値（変更不可）

| n | 判定 | ROI条件 |
|---|------|---------|
| < 300 | データ不足・判定不可 | — |
| 300〜600 | 継続保留 | ROI < 0.75 → 撤退候補 |
| 600〜1000 | 条件付き採用判定 | ROI > 1.2 + 月別・ratio帯別に一発依存でない |
| 1000〜 | 採用確定に近い | 最大払戻除外ROI > 1.0 |

- 外部検証(2020-2023) ROI ≈ 0.74（ランダムベット水準）= **edge未確認**
- このしきい値は根拠: 3連単の標準偏差は1ベットあたり6〜8 ROI単位。n=600未満では判定不能。
- A2は BUY除外確定（外部検証 ROI=0.63）。しきい値を満たしても復活させない。
- app_settings は変更しない。条件変更はしきい値達成後に別途検討。

### live記録の設計（重要）

ライブ決定と generate:history はどちらも `source="history-model"` で保存される。  
区別は `model_version` と `date` のみで行う。条件: `model_version=boatpon-v3-alpha15 AND date>=2026-01-01`

自動除外されるもの:
- 旧モデル: `model_version=boatpon-v2-regime-category` 等 → 除外
- sampleデータ: `model_version=null`（プログラムデータなし時のフォールバック）→ 除外

除外されない汚染リスク:
- generate:historyを2026年対象で実行した場合 → `model_version=boatpon-v3-alpha15` が付くため混入する

診断: LiveMonitorPanel の「診断: 2026年BUY全件内訳」で除外対象を確認できる。
CLI確認: `npm run monitor:live` でサーバー起動なしに同じ監視サマリーを読み取り専用で確認できる。

蓄積経路:
- `/api/dashboard` が `buildCandidateRows` の各候補に対して `insertDecisionHistory` を呼ぶ。
- `buildCandidatesFromModel` 由来の候補は `source="history-model"` と `model_version=boatpon-v3-alpha15` を持つ。
- `npm run monitor:live` の `latestModelDecision` が空なら、2026年のv3実運用判定履歴がまだ保存されていない。
- `latestModelDecision` がありBUYだけ0なら、保存経路は動いているがBUY条件未達と見る。

### 注意: generate:history を 2026年対象で実行しない

generate:historyで2026年の decision_history を生成すると監視データが汚染される。  
2026年の generate:history 実行は明示承認なしに行わない。

#### ガード仕様（scripts/generate-decision-history.ts 実装済み）

`--to` が `2026-01-01` 以降を含む場合、`--allow-live-write` フラグなしでは exit(1) で停止する。

```
# 停止される（ガード発動）
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100

# 許可される（dry-runはガード対象外）
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100 --dry-run

# 意図的に実行する場合のみ（通常使用禁止・事前承認必須）
npm run generate:history -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N --allow-live-write
```

## 見るべき画面

1. Backtest > モデル比較
2. Backtest > 2026ライブ監視
3. Backtest > Calibration分析（外部/in-sample比較）
4. Dashboard > モデル監視
5. Dashboard > 番組カテゴリ別ROI
6. Dashboard > 会場別ROIヒートマップ
7. Backtest > 時系列検証

## 判定履歴の増やし方

外部取得なしで、保存済みの公式番組表と結果からウォークフォワード判定履歴を作れる。
補完対象を増やす時は、まず短い期間・少ない件数で dry-run する。

```bash
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100 --include-required-odds-candidates
npm run generate:history -- --from 2025-05-01 --to 2025-05-21 --limit 100
npm run generate:history -- --from 2025-05-01 --to 2025-05-21 --limit 100 --refresh-existing --include-skips
```

- `--from`, `--to`, `--limit` は必須。
- 書き込み実行は2025年以前だけにする。2026年以降は dry-run 以外で対象にしない。
- 学習期間はデフォルトで対象開始日の180日前から。変える場合は `--train-days 365` のように指定する。
- デフォルトでは BUY/WATCH のみ保存し、SKIPは保存しない。
- `--include-skips` を付けた時だけSKIPも保存する。
- `--include-required-odds-candidates` を付けると、オッズ未取得でも必要オッズ80倍以下の候補を保存対象にできる。
- 同じ期間を再実行しても、同じ `raceId + selection` の履歴は重複保存しない。
- `--refresh-existing` を付けると、補完済みオッズを使って既存履歴の `currentOdds / EV / decision` を再計算する。
- 外部サイトにはアクセスしない。
