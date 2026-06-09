# boat-pon — AI エージェント向け運用ガイド

## 絶対禁止事項

- DBへのINSERT/UPDATE/DELETE/DROPは禁止
- app_settings変更禁止
- 本番 decision ロジック変更禁止
- 自動投票・ログイン保存・投票サイト操作禁止
- BUYは検証候補であり購入指示ではない
- ROIは検証指標であり購入推奨ではない
- data/ と backups/ を削除しない

## ROI 評価基準（2025-06 以降統一）

- **主評価**: `race_payouts.payout_yen` 実払戻ベース
- **補助参考**: `current_odds`（締切前暫定値、約14.94ptの楽観バイアスあり）
- gap >= 10pt の条件は current_odds 判断を信頼しない

## 候補監視 3点セット

データが更新されたら以下の順で実行する:

```bash
pnpm report:paper-forward-candidates        # 台帳: switch/除外/残存/過信注意の一覧
pnpm report:paper-forward-monitor           # 訓練/forward比較・格上げ判定・除外候補追跡
pnpm analyze:wind24-exh1-switch             # 最有力候補の深掘り（最大払戻除外・月別・会場別）
```

確認ポイント: **条件B 3連単1-3-2 が forward n=200 到達後に 最大2件除外ROI ≥ 100% を満たすか**（現在 n=167 / top2除外 91.08%）

## 現在フェーズ（2025-06 時点）

**昇格/降格ルールの運用フェーズ**。候補探しは一旦終了。

### 最有力候補: 風速2〜4 × 1号艇展示1位 → 1-3-2 switch

- 現在判定: **格上げ待ち**（forward n=167 / 目標 n=200）
- 格上げ条件:
  - forward n ≥ 200
  - 最大2件除外 ROI ≥ 100%
  - 直近3ヶ月 0% なし
  - 1-3-2 が 1-2-3 を継続して上回る
- 降格条件: 最大2件除外 ROI < 95% かつ 直近3ヶ月連続0hit
- **app_settings変更はしない。forward観察のみ。**

### その他の候補状態

| 候補 | 状態 |
|---|---|
| 住之江 × odds40〜49 → 1-3-2 | 判定不可（forward n=23） |
| 住之江 × 1号艇展示1位 → 1-3-2 | 判定不可（forward n=18） |
| 住之江 × 5R → 1-3-2 | 判定不可（forward n=10） |
| 住之江 × odds25〜39 | 残す（payout 110.82%） |
| 1号艇展示1位 除外 | 改善あり、黒字未達（残存 91.42%） |
| 除外候補群 | 方向一致だが主力ではない |

## 重要な発見サマリ（参照用）

- 全体 current_odds ROI ≈ 100.79% だが実払戻 ROI ≈ 85.85%（gap 14.94pt）
- 1-2-3 が多数でも、条件によっては 1-3-2 の方が実払戻が高い
- forward急伸（訓練期弱く forward期強い）は高配当依存チェック必須
- 除外だけでは黒字化しない（最大複合除外でも残存 97%）
- 条件別券種セレクター検証（2025-06）: セレクター化で改善なし（forward 79% < 現行 87%）
  - 拡連複: 全条件最下位。不採用確定
  - 住之江系: n<30のため data-insufficient（過学習リスクあり、凍結）
  - 条件B 3連単1-3-2: セレクターとしては不採用だが forward急伸monitor として継続
    （train 66% → forward 174%。top2除外 91%のため格上げ条件未達）

## 分析スクリプト一覧（読み取り専用）

| スクリプト | 目的 |
|---|---|
| `analyze:odds-payout-gap` | current_odds vs 実払戻 乖離 14条件分析 |
| `analyze:payout-rebase` | 全候補を実払戻基準で再集計・3分類 |
| `report:paper-forward-candidates` | paper-forward 台帳（switch/除外/残存） |
| `report:paper-forward-monitor` | forward 訓練比較・格上げ判定 |
| `analyze:wind24-exh1-switch` | 最有力候補の深掘り |
| `analyze:roi-bad-conditions` | 除外候補の発見（current_odds基準、参考） |
| `analyze:suminoe-breakdown` | 住之江分解（参考） |
| `analyze:123-breakdown` | 1-2-3 selection 分解（参考） |
| `analyze:123-bet-type-conversion` | 券種変換比較（実払戻基準） |
| `analyze:ticket-selector-strategies` | 条件別券種/買い目セレクター検証（12条件×9券種、セレクター比較） |
