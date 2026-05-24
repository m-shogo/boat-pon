# Boat Pon 失敗・学びログ

目的: 同じ失敗を繰り返さず、重い作業の前に地面を固めるための記録。

このファイルには、モデル改善・データ取得・検証・運用で分かったことを短く残す。大きな方針は `docs/model-roadmap.md` にまとめ、ここには原因、再発防止、次の確認コマンドを書く。

## 記録ルール

- 失敗、違和感、改善できたこと、次回の注意を残す。
- ROIだけで勝ち判定しない。n、月別、会場別、オッズ帯別を見る。
- 重い作業の前に、小さい期間・読み取り専用SQL・dry-runで確認する。
- 外部取得、DB大量更新、判定ロジック変更は、前後の件数とROIを必ず記録する。
- `payout_yen` と `current_odds` を混ぜない。検証ROIは `current_odds` 基準に統一する。

## 重い作業前チェック

1. `git status --short` で未コミット差分を確認する。
2. 触る対象を分ける。DB更新中はコード編集を並行しない。
3. 外部取得系を走らせる前に、期間、limit、キャッシュ有無、禁止事項を確認する。
4. `generate:history` は短い期間で dry-run または小さい limit から始める。
5. 実行前後で以下を確認する。

```bash
npm run test

sqlite3 data/boat.sqlite "
SELECT decision, COUNT(*) AS n
FROM decision_history
WHERE date >= '2025-01-01' AND date <= '2025-11-30'
GROUP BY decision
ORDER BY decision;

SELECT COUNT(*) AS duplicate_races
FROM (
  SELECT race_id, COUNT(*) AS c
  FROM decision_history
  WHERE date >= '2025-01-01' AND date <= '2025-11-30'
  GROUP BY race_id
  HAVING c > 1
);
"
```

## 採用判定テンプレ

新しいフィルター、モデル、しきい値を採用する時は、この形で残す。

```text
日付:
変更候補:
目的:
学習/探索に使った期間:
検証に使った期間:
BUY数:
的中数:
ROI(current_odds基準):
月別で崩れた月:
会場別の偏り:
オッズ帯別の偏り:
過学習リスク:
採用/保留/却下:
次に見ること:
```

採用の目安:

- 総ROIだけで採用しない。
- BUY数が少ない場合は、ROIが高くても保留する。
- 月別0的中が多い条件は、たまたま高配当を拾った可能性を疑う。
- 探索した期間と同じ期間の結果だけで採用しない。
- 運用ルールに入れる前に、まず「候補を減らすフィルタ」として見る。

## Claude/Codex引き継ぎテンプレ

重い作業を別エージェントに渡す時は、以下を貼る。

```text
作業場所: /Users/m-shogo/Developer/personal/boat-pon
使用DB: data/boat.sqlite
使わないDB: data/boat-pon.db

禁止:
- fetch:official-results / fetch:official-programs / fetch:kyotei24 を勝手に実行しない
- data/raw/official 以下を触らない
- rm / pkill / kill / git reset / git checkout -- を勝手に使わない
- 自動購入・自動投票・ログイン保存を実装しない
- payout_yen をROI検証に使わない

注意:
- ROIは current_odds 基準
- DB更新中に別エージェントがDB更新しない
- 未コミット差分を読んでから作業する
- generate:history 後は duplicate_races と旧モデルBUY残りを確認する
- 重い処理前に小さい期間かdry-runで確認する
```

## 2026-05-24: alpha=1 は過大推定が強すぎた

- 種別: モデル/キャリブレーション
- 状況: `buildVenueModel` の Laplace alpha が 1 で、会場ごとの最良買い目選択により cherry-picking バイアスが出た。
- 症状: 30倍以上のオッズ帯で、推定的中率が実測の数倍になった。
- 対応: `DEFAULT_MODEL_ALPHA=15` に変更し、モデルバージョンを `boatpon-v3-alpha15` に更新。
- 学び: 単に過去で一番当たった買い目を選ぶと、特に高オッズ帯で推定が膨らむ。alpha変更後も30倍以上は過大推定が残るため、号艇/番組表特徴を買い目生成に使う必要がある。
- 次回確認: オッズ帯別の推定的中率、実測的中率、過大倍率を必ず見る。

## 2026-05-24: `refresh-only` で旧買い目が残った

- 種別: データ更新/履歴整合性
- 状況: alpha変更で同じ race_id の推奨 selection が変わった。
- 症状: `race_id + selection` だけで既存判定を見ると、旧selection行が残り、新selection行と二重化した。
- 対応: `--refresh-existing --refresh-only` では race_id 単位でも既存行を置換し、同一race_idの余分な行を削除するようにした。
- 学び: モデル変更時は「同じレースで買い目が変わる」前提で履歴更新を設計する。
- 次回確認: `duplicate_races` が0か、旧モデルのBUYが残っていないかを見る。

## 2026-05-24: ROI計算で `payout_yen` と `current_odds` が混ざった

- 種別: 分析/指標定義
- 状況: バックテストやUI集計の一部が公式払戻 `payout_yen` を使っていた。
- 症状: ユーザー指定のROI式 `SUM(hit ? current_odds : 0) / COUNT(*)` と画面のROIがズレる可能性があった。
- 対応: ドメイン集計、walk-forward、daily-brushupを `current_odds` ベースに統一。
- 学び: 指標定義はコード全体で一箇所に寄せる。検証ROIと実購入損益は分けて考える。
- 次回確認: `rg "payout_yen AS payout|THEN payout|row\\.payoutYen \\?\\? 0" src server scripts` で混入を探す。

## 2026-05-24: ratio帯だけで採用しそうになった

- 種別: 過学習/採用判断
- 状況: `current_odds / required_odds = 1.5〜2.0x` が一時的にROI 1.0前後に見えた。
- 症状: 月別に見るとnが少なく、0的中月が多く、安定採用できる根拠としては弱かった。
- 対応: 採用保留。年別、月別、会場別、オッズ帯別の外部検証待ちにした。
- 学び: 総ROIが良くても、分割したら壊れる条件は過学習候補。条件探索後は必ず別期間で確認する。
- 次回確認: 2024年以前のオッズで同じ条件を固定して検証する。

## 2026-05-24: 高オッズ帯の過大推定は除外より補正で扱う

- 種別: モデル/設定
- 状況: 2024+2025で、20〜30倍帯はcalibrationが良好だが、30倍以上は推定的中率が実測の約2倍に残った。
- 症状: 30〜50倍、50〜100倍を単純除外するとデータ解像度を落とす。だが無補正のままだとEVが過大になる。
- 対応: `BudgetRule.calibrationMode`, `calibrationBasis`, `oddsCalibrationFactors` を追加し、`v3-empirical` で必要オッズ帯または取得オッズ帯別に推定的中率へ係数を掛けられるようにした。デフォルトは `none`。
- 学び: 高オッズ帯の問題は「買わない」だけでなく「期待値を正しく測る」方向で扱う方が、後のモデル改善につながる。
- 結果: `requiredOdds` 基準は高市場オッズ帯に効き切らず、`currentOdds` 基準はBUYを減らしすぎてROIを悪化させた。2025-01〜11では `currentOdds` 基準ONでBUY 653件、ROI 0.622。採用せず、DB設定は `calibrationMode=none` に戻した。
- 次回確認: 係数を本番ONする前に、2024/2025を分けた外部検証と月別0的中月を見る。現時点では「実験用オプション」として扱う。

## 2026-05-24: 番組表特徴フィルター探索（候補）

### 検証済みで失敗したもの

| フィルター | 2024 ROI (n) | 2025 ROI (n) | 判定 |
|-----------|-------------|-------------|------|
| レース番号>=9 | 高 (探索) | 0.792 (740) | 却下: 逆転 |
| モーター2連率>=30% | 高 (探索) | 0.802 (1061) | 却下: 逆転 |
| A2 + オッズ<=50 | 1.475 (320) | 0.570 (497) | 却下: 逆転 |

### ⚠️ A2 × モーター<40%: SQL分析は楽観的だった → 却下

```text
日付: 2026-05-24
変更候補: A2クラス × モーター2連率<40% で BUY を絞る除外フィルタ
目的: 全BUY ROI 0.85前後を ROI>1 に引き上げる
学習/探索に使った期間: 2024年 (SQL後処理分析)
検証に使った期間: 2025-01〜11 (SQL後処理分析)

SQL後処理分析 (BUY内フィルター):
  BUY数: 探索=543, 検証=523
  ROI: 探索=1.197, 検証=1.126

実装後 (programFilter ONで全期間リフレッシュ):
  BUY数: 探索=810, 検証=762 (SQL分析より多い)
  ROI: 探索=0.761, 検証=0.909
  ベースライン: 探索=0.848, 検証=0.865
  → 2024は悪化、2025はわずかな改善のみ

月別で崩れた月: 3/12 (2024), 3/11 (2025) ← ベースラインと同じ
採用/保留/却下: 却下
```

**失敗の原因: SQL後処理分析のバイアス**

- SQL分析は既存BUYレコード内での後処理フィルター → 高EV候補のみ対象
- 実装すると WATCH（EV 1.05〜1.25の低質候補）もBUY昇格し、ROIを引き下げた
- BUY数が 543→810 に増えたのはこのWATCH昇格が原因
- **教訓: programFilter の効果測定は必ずエンジンを通して評価する。SQL後処理分析は過楽観になる**

**次回確認コマンド:**
```bash
# programFilter をONにしてリフレッシュした後、必ずこれで確認
sqlite3 data/boat.sqlite "
SELECT substr(date,1,4) AS year, COUNT(*) AS n,
  SUM(CASE WHEN substr(selection,1,1)||'-'||substr(selection,3,1)||'-'||substr(selection,5,1) = result THEN 1 ELSE 0 END) AS hits,
  ROUND(SUM(CASE WHEN substr(selection,1,1)||'-'||substr(selection,3,1)||'-'||substr(selection,5,1) = result THEN current_odds ELSE 0 END) / NULLIF(COUNT(*),0), 3) AS roi
FROM decision_history
WHERE date BETWEEN '2024-01-01' AND '2025-11-30' AND decision='BUY' AND model_version='boatpon-v3-alpha15'
GROUP BY year;
"
```

### フィルター比較表（2024 探索 / 2025 検証）

| フィルター | 2024 n | 2024 ROI | 2025 n | 2025 ROI | 0的中月 |
|-----------|--------|----------|--------|----------|--------|
| 全BUY (ベースライン) | 3957* | 0.775* | 2443 | 0.865 | 3/11 |
| A2クラスのみ | 678 | 1.074 | 655 | 1.033 | 3/11 |
| A2 + モーター<40% | 543 | 1.197 | 523 | 1.126 | 3/11 |
| モーター<40%のみ | 2277 | 0.904 | 1971 | 0.892 | 未確認 |
| A2 + モーター>=40% | 135 | 0.581 | 132 | 0.667 | — |

- モーター>=40% は全BUYでも除外候補 (2024: 0.597, 2025: 0.751)
- 全国勝率>=5.0 の追加はわずかな改善のみ（n: 543→497、過学習リスク増）
- A2単体が最もシンプルで一貫性が高い
- *2024ベースラインは DB再生成後に変わった（旧 n=2788/ROI=0.848 → 新 n=3957/ROI=0.775）。odds全量揃い後の正確な値は 3957/0.775

### 次のアクション

1. 2023年以前データ取得後、同条件 (A2 + motor<40%) を固定して外部検証
2. 月次 n が十分かどうか（目標: 月40件以上）確認
3. A2 級の該当率をリアルタイムプログラムで確認（実用性チェック）
4. `BudgetRule.programFilter` は実装済み。採用前にDB設定ONで再生成し、採用判定テンプレに沿って記録する

## 2026-05-25: --refresh-existing はDB状態を壊す可能性がある

- 種別: データ更新/操作安全性
- 状況: programFilter ON でリフレッシュ後、OFF に戻してもとに戻らなかった
- 症状: BUY が 5231 → 1572（filter ON）→ 7366（restore試み）。元に戻らず
- 原因:
  - `--refresh-existing --refresh-only` は `listProgramInputsWithOddsSnapshotsRange` を使い、odds_snapshots のある全プログラムを再評価する
  - 新たに odds が揃ったレコードも BUY に昇格するため、元の件数より増える
  - BUY→SKIP させたレコードが restore で適切に戻らないケースがある
- 対応: `DELETE + 再生成` で完全復元した（2025: BUY=2443復元, 2024: BUY=3957で安定）
- 学び:
  - SQL後処理フィルター分析の結果 (ROI 1.197) は実装後と乖離する（実装後: ROI 0.761/0.909）
  - **programFilter の効果測定は必ず「DELETE + 再生成」で評価する。--refresh-existing は不十分**
  - 設定を変えたら必ず `DELETE + 再生成` → ROI確認 → 戻す場合は再度 `DELETE + 再生成`
- 次回確認:
  ```bash
  # 安全な設定変更フロー
  # 1. 現状を記録
  sqlite3 data/boat.sqlite "SELECT decision, COUNT(*) FROM decision_history WHERE date>='2025-01-01' AND model_version='boatpon-v3-alpha15' GROUP BY decision;"
  # 2. 設定変更後に DELETE + 再生成
  sqlite3 data/boat.sqlite "DELETE FROM decision_history WHERE date BETWEEN '2025-01-01' AND '2025-11-30' AND model_version='boatpon-v3-alpha15';"
  npm run generate:history -- --from 2025-01-01 --to 2025-11-30 --limit 100000 --include-skips
  # 3. 元に戻す場合も DELETE + 再生成
  ```

## 今後の地面固め順序

1. 2025年で候補条件を作る。✅ A2 × motor<40% は却下（実装後ROI 0.761/0.909）
2. 2024年以前のデータで、条件を変えずに外部検証する。← 次の優先事項
3. 勝てそうな条件が月別・会場別で崩れないか見る。
4. 号艇/番組表特徴は SQL後処理でなくエンジン評価で測定する。
5. 120通りスコアリングモデルは、データ定義と検証基準を固めてから作る。
