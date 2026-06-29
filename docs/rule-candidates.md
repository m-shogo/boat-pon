# Rule candidates review process

`report:quality` の `Rule suggestions` は、そのまま live 設定へ反映しない。
ここは「採用候補 / 保留 / 除外候補」を溜めて、週次・月次で判断するためのメモです。

## 目的

Boat Pon は、買うレースを増やすアプリではなく、期待値がありそうな候補だけを絞り込み、弱い条件を見つけて削るための検証アプリです。

そのため、1回の週次レポートで出た良い/悪い結果だけで live ルールを変えない。
以下の順番で確認してから、初めて採用候補にします。

```txt
report:weekly
↓
report:monthly
↓
walk:history
↓
decision:dry-run
↓
live反映候補
```

## 毎週の確認手順

```sh
npm run validate:data
npm run report:weekly
npm run report:monthly
npm run walk:history -- --window-days 30 --step-days 7 --min-buys 5
npm run decision:dry-run
```

見る順番は以下。

1. `validate:data` でデータ欠損・鮮度・BUY異常がないか見る
2. `report:weekly` で直近7日の弱い条件を見る
3. `report:monthly` で直近30日でも同じ弱さが出るか見る
4. `walk:history` で期間をずらしても崩れていないか見る
5. `decision:dry-run` で今日の通知候補に変なBUYが混ざっていないか見る

## 自動追記

`report:quality -- --json` の `ruleSuggestions` は、`append:rule-candidates` でこのファイルへ追記できます。
追記直後はすべて `watch` として扱い、週次レビューで `candidate` / `reject` / `adopted` に変更します。

```sh
npm run report:quality -- --json > /tmp/boat-quality.json
npm run append:rule-candidates -- --input /tmp/boat-quality.json
```

標準入力から直接渡すこともできます。

```sh
npm run report:quality -- --json | npm run append:rule-candidates --
```

任意の出力先・初期ステータスを指定する例。

```sh
npm run append:rule-candidates -- \
  --input /tmp/boat-quality.json \
  --output docs/rule-candidates.md \
  --status watch \
  --evidence report:monthly \
  --action 追加観察 \
  --next-check next weekly
```

注意:

- 自動追記は live 設定を変更しない
- 自動追記された候補は採用ではなく `watch`
- `candidate` にする前に、月次・walk-forward・dry-runを必ず確認する
- `adopted` に変える時は、採用理由と日付を残す

## 週次レビューの自動実行

毎週日曜22:00に、Mac の `launchd` で以下を自動実行できます。

```txt
validate:data
↓
report:quality --days 30 --json
↓
append:rule-candidates
↓
docs/rule-candidates.md に候補追記
↓
logs/weekly-rule-review.log に記録
```

初回だけ、ローカルで以下を実行します。

```sh
chmod +x scripts/run-weekly-rule-review.sh

cp docs/launchd/com.shogo.boat-pon.weekly-review.plist ~/Library/LaunchAgents/

launchctl unload ~/Library/LaunchAgents/com.shogo.boat-pon.weekly-review.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.shogo.boat-pon.weekly-review.plist
```

手動で動作確認する場合:

```sh
BOAT_PON_ROOT_DIR=/Users/m-shogo/Developer/personal/boat-pon \
  bash scripts/run-weekly-rule-review.sh

tail -n 80 logs/weekly-rule-review.log
```

登録状態を確認する場合:

```sh
launchctl list | grep com.shogo.boat-pon.weekly-review || true
```

停止したい場合:

```sh
launchctl unload ~/Library/LaunchAgents/com.shogo.boat-pon.weekly-review.plist
```

注意:

- この自動実行は live 設定を変更しない
- 自動購入・自動投票はしない
- 候補ログ追記だけを行う
- 追記された候補は初期状態では `watch`
- 採用する場合は、月次・walk-forward・dry-runを確認してから人間が判断する

## 判定ステータス

| status | 意味 | live反映 |
|---|---|---|
| `candidate` | 採用候補。複数期間で安定している | まだ直接反映しない |
| `watch` | 保留。サンプル不足または結果が割れている | 反映しない |
| `reject` | 除外候補。ROIや的中率が弱い | BUYへ昇格しない |
| `adopted` | 採用済み。理由と日付を残す | 反映済み |
| `reverted` | 戻したルール。理由を残す | 反映しない |

## 採用してよい条件

以下をすべて満たす時だけ `candidate` にする。

- `validate:data` に error がない
- 確定BUYが最低20件以上ある
- `report:monthly` でROIが1.0以上
- `walk:history` で fail window が多くない
- 会場別・レース番号別で極端に弱い偏りがない
- `decision:dry-run` で不自然なBUYが出ていない

## すぐ採用してはいけない条件

以下のどれかに当てはまる場合は `watch` または `reject`。

- 直近7日だけ良い
- 確定BUYが20件未満
- S帯よりA帯/B帯の方が強く見える
- 1会場だけの成績で良く見える
- 特定レース番号だけで大きく負けている
- オッズ欠損やEV欠損がある
- `walk:history` で一部期間だけ極端に良い

## よくある Rule suggestions の扱い

### B帯は通知対象外候補

基本方針:

- `B` はBUY通知にしない
- `WATCH` または `SKIP` に寄せる
- 月次でROIが継続して1.0を超えるまで採用しない

記録例:

```md
### 2026-05-30 B帯通知除外

- status: watch
- source: npm run report:monthly
- reason: B帯のROIが1.0未満
- action: B帯は通知せずWATCH以下を維持
- next_check: 次回月次
```

### A帯はdry-run継続候補

基本方針:

- `A` はすぐ通知しない
- `decision:dry-run` で候補だけ確認
- S帯との差が安定するまで本番通知しない

### S帯が弱い

基本方針:

- 一番危険な警告
- S条件が狭すぎて過学習している可能性がある
- オッズ閾値、sample_size、会場・レース番号偏りを確認する

確認コマンド:

```sh
npm run report:monthly
npm run walk:history -- --window-days 30 --step-days 7 --min-buys 5
npm run decision:dry-run
```

### 特定レース番号が弱い

例: `5R はWATCH止まり候補`

基本方針:

- そのレース番号をすぐ全除外しない
- 月次とwalk-forwardでも弱い場合だけWATCH寄せ候補
- S帯だけは残す、A/Bは通知対象外、のように段階的に絞る

### 特定会場が弱い

基本方針:

- まずS条件のみ通知候補にする
- A/B帯は通知対象外に寄せる
- 会場ごとのサンプルが少ない時は保留

## 週次メモテンプレート

```md
## YYYY-MM-DD weekly review

### Commands

- [ ] npm run validate:data
- [ ] npm run report:weekly
- [ ] npm run report:monthly
- [ ] npm run walk:history -- --window-days 30 --step-days 7 --min-buys 5
- [ ] npm run decision:dry-run

### Summary

- validate:data:
- weekly ROI:
- monthly ROI:
- walk:history verdict:
- dry-run issue:

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| B帯通知除外 | watch | monthly ROI < 1.0 | WATCH以下維持 | next monthly |
| 5R WATCH寄せ | watch | 5R ROI < 1.0 | 追加観察 | next weekly |

### Decision

- adopted:
- watch:
- reject:
- notes:
```

## 現在の候補ログ

まだ候補なし。

次回から `report:weekly` / `report:monthly` の `Rule suggestions` をここに転記するか、`append:rule-candidates` で自動追記する。

---

## データカバレッジ確認

モデル改善の前に必要なデータが揃っているかを確認する。

```bash
# テキスト表示（7項目の OK / PARTIAL / MISSING を出力）
npm run report:data-coverage

# JSON 出力（CI・スクリプト連携用）
npm run report:data-coverage -- --json
```

結果の見方:
- `✅ OK` — 十分なデータあり。モデルへの組み込み・分析が可能
- `⚠️ PARTIAL` — データあり、ただし疎 or 専用テーブルなし。取得スクリプトの安定稼働が先決
- `❌ MISSING` — 未実装。`docs/data-roadmap.md` で優先度と設計方針を確認してから着手

各項目の詳細（目的・保存カラム・注意点）は [`docs/data-roadmap.md`](data-roadmap.md) を参照。

## 2026-05-31 auto candidate review

### Source

- period: 2026-05-02..2026-05-31
- generatedAt: 2026-05-31T13:00:06.602Z
- BUY: 47
- settledBUY: 44
- hits: 2
- ROI: 0.748

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 多摩川 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | adopted | report:monthly | `venueSignalBandRules` で実装 | next weekly |
| 常滑 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | adopted | report:monthly | `venueSignalBandRules` で実装 | next weekly |
| 徳山 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | adopted | report:monthly | `venueSignalBandRules` で実装 | next weekly |
| 桐生 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | adopted | report:monthly | `venueSignalBandRules` で実装 | next weekly |
| S帯が弱い。S条件の過学習、オッズ閾値、sample_size条件を再確認する。 | watch | report:monthly | 追加観察 | next weekly |

## 2026-06-07 auto candidate review

### Source

- period: 2026-05-09..2026-06-07
- generatedAt: 2026-06-07T13:00:04.222Z
- BUY: 47
- settledBUY: 44
- hits: 2
- ROI: 0.748

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 多摩川 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 常滑 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 徳山 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 桐生 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| S帯が弱い。S条件の過学習、オッズ閾値、sample_size条件を再確認する。 | watch | report:monthly | 追加観察 | next weekly |

---

## 2026-06-08 overnight ROI analysis (analyze-roi-decision-lab)

### Source

- script: `scripts/analyze-roi-decision-lab.ts`
- baseline: n=6260 BUY rows, ROI=80.38%, hits=124 (historical-backfill, decision='BUY')
- period: 2024-2025-2026 (2024/2025 year split analysis)
- branch: `codex/regenerated-ab-roi-analysis`
- generatedAt: 2026-06-08T朝

### 月別ROI発見 (最重要)

月による ROI の系統的な差が確認された：

| 月 | ROI | n(新NO_BUY残り×月) | 備考 |
|---|---|---|---|
| 4月 | 280.88% | 113 | 最強 |
| 6月 | 206.28% | 137 | 安定 |
| 8月 | 148.96% | 212 | **弱い** |
| 12月 | 187.18% | 103 | 安定 |
| 5月 | 弱い | - | 月4+6+8+12 from 月5+7除外実験 |
| 7月 | 弱い | - | 同上 |

**→ 月8・月5・月7が弱く、月4・6・12が強い**

### 新発見S/A候補条件 (KEEP系)

| 判定 | 条件 | n | ROI | 2024ROI | 2025ROI | test | 備考 |
|---|---|---|---|---|---|---|---|
| **A** | 新NO_BUY残り×月4+6+12 | 353 | **224.59%** | 215.89% | 238.81% | 0% | ★最強安定月条件 |
| **A** | 新NO_BUY残り×月4+6+12×racerTop3>=0.5 | 335 | **216.48%** | 199.61% | 242.42% | 0% | |
| **A** | 新NO_BUY残り×月4+6+12×odds>=30 | 328 | **207.74%** | 182.53% | 246.15% | 0% | |
| **A** | 新NO_BUY残り×月4+8×racerTop3>=0.5 | 312 | **202.95%** | 163.16% | 242.23% | 137% | |
| **A** | 新NO_BUY残り×月4+6+8+12 | 565 | 196.21% | 186.10% | 210.73% | 297% | |
| **A** | 新NO_BUY残り×月4+8+12×racerTop3>=0.5 | 408 | 195.64% | 166.49% | 242.23% | 297% | |
| **A** | 新NO_BUY残り×月4+6+8+12×racerTop3>=0.5 | 539 | 193.14% | 178.10% | 213.49% | 297% | |
| **A** | 新NO_BUY残り×raceNo7-9×month4-9 | 302 | 241.72% | 303.16% | 175.69% | 126% | 高ROI・2年前後あり |
| **A** | 新NO_BUY残り×月4+6+8+12×odds20-50 | 416 | 178.39% | 174.54% | 184.81% | 386% | test=386%強い |

**注意: test=0% は、最近10%期間にhitがなかった (件数自体はある) ことを示す。年別ROIは両年安定。**

### サブフィルター発見 (B/C級、将来の参考)

月4+6+12×wind>=5: n=102, **ROI=275.98%**, 2024=247.41%, **2025=313.64%** (両年安定!)
月4+6+12×exSt<0.08: n=117, **ROI=253.50%**, 2024=199.32%, **2025=343.41%** (両年安定!)
月4+8+12×wind>=5: n=120, **ROI=303%** (B判定)
月4×racerTop3>=0.5: n=108, **ROI=294%** (B判定、4月特化)

### 会場シグナル (C判定、参考値)

月4+6+12ベースの会場別上位：
- 丸亀 (n=16): ROI=**714%**, 2024=696%, **2025=754%** (両年爆発的！)
- 蒲郡 (n=21): ROI=**540%**, 2024=509%, 2025=569% (両年安定！)
- 唐津 (n=18): ROI=**475%**
- 平和島 (n=23): ROI=**337%**

→ 丸亀・蒲郡は両年とも非常に強い。ただしn<50のためC判定。継続観察が必要。

### exSt dead zone 確認

exSt 0.10-0.15 を除外すると ROI が系統的に改善することを確認:
- 除外なし: ROI=177.49%
- 除外あり: ROI=197.82% (+20%)

### 既存NO_BUYフィルター評価 (NO_BUY系)

既存の NO_BUY ルール (月1-3除外, raceNo>=10除外, 戸田/多摩川除外, 月9除外, wind<3除外, F>=1除外) に
さらに exSt0.10-0.15除外を加えた「新NO_BUY残り」が最良のベースとなった:
- 新NO_BUY残り全件: n=2573, ROI=119.07%
- 月4+6+12に絞ると: n=353, ROI=224.59%

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 新NO_BUY残り×月4+6+12 (n=353, ROI=224%) | candidate | analyze-roi-decision-lab 2024/2025両年安定 | paper検証。月4,6,12の3ヶ月のみBUY候補 | 月次レビュー |
| 新NO_BUY残り×月4+6+12×racerTop3>=0.5 (n=335, ROI=216%) | candidate | analyze-roi-decision-lab 両年安定 | paper検証と月別サンプル確認 | 月次レビュー |
| 新NO_BUY残り×月4+6+8+12 (n=565, ROI=196%) | candidate | analyze-roi-decision-lab test=297% | paper検証。月5/7/9/10/11/1-3除外 | 月次レビュー |
| 新NO_BUY残り×raceNo7-9×month4-9 (n=302, ROI=241%) | watch | analyze-roi-decision-lab test=126% | 高ROIだがtrain/val不均衡あり。追加観察 | 月次レビュー |
| exSt 0.10-0.15 dead zone除外 | candidate | analyze-roi-decision-lab 系統的改善確認 | 新NO_BUY残り条件に組み込み済み | 実装時 |
| 月8弱シグナル (ROI=149% vs 月4=280%) | watch | analyze-roi-decision-lab | 月8単独除外の live 影響を dry-run で確認 | dry-run後 |
| 丸亀×月4+6+12 (n=16, ROI=714%) | watch | analyze-roi-decision-lab C判定(n<50) | n不足。2026年6月以降も同傾向か監視 | 月次レビュー(n増加待ち) |


---

## 2026-06-08 overnight ROI analysis — 追記 (年別安定性最終確認)

### 2024/2025年別安定性ランキング (n>=300 KEEP条件)

両年とも ROI>100% の条件を2025ROIでソート (2025年は直近なのでより重要):

| 条件 | n | ROI | 2024 | 2025 | test | 安定性評価 |
|---|---|---|---|---|---|---|
| 新NO_BUY残り×月4+8×racerTop3>=0.5 | 312 | 203% | 163% | **242%** | 297% | ★★★ 2025増加 |
| 新NO_BUY残り×月4+6+12×odds>=30 | 328 | 208% | 183% | **246%** | 0% | ★★★ 2025増加 |
| 新NO_BUY残り×月4+6+12×racerTop3>=0.5 | 335 | 216% | 200% | **242%** | 0% | ★★★ 2025増加 |
| 新NO_BUY残り×月4+6+8+12×odds>=30 | 515 | 184% | 171% | **201%** | 322% | ★★★ 2025増加+test強い |
| 新NO_BUY残り×月4+6+8+12×racerTop3>=0.5 | 539 | 193% | 178% | **213%** | 297% | ★★★ 2025増加+test強い |
| 新NO_BUY残り×月4+6+8+12 | 565 | 196% | 186% | **211%** | 297% | ★★★ 2025増加+test強い |
| 新NO_BUY残り×月4+8+12×racerTop3>=0.5 | 408 | 196% | 166% | **242%** | 297% | ★★★ 2025増加+test強い |
| 新NO_BUY残り×月4+6+12 | 353 | 225% | 216% | **239%** | 0% | ★★★ 最高ROI+両年均衡 |
| 新NO_BUY残り×raceNo7-9×month4-9 | 302 | 242% | 303% | 176% | 108% | ★★ 2024偏重リスク |
| 新NO_BUY残り×raceNo7-9×racerTop3>=0.5 | 392 | 202% | 232% | 158% | 0% | ★★ 2024偏重リスク |

### 月別ROIパターン (新NO_BUY残り×racerTop3>=0.5 の月別内訳)

| 月 | ROI | n | 評価 |
|---|---|---|---|
| 4月 | 293% | 108 | ◎ 最強 |
| 6月 | 185% | 131 | ◎ 強い |
| 12月 | 171% | 96 | ○ 安定 |
| 8月 | 154% | 204 | △ 弱めだが正 |
| 5月 | 117% | 186 | △ 弱い |
| 7月 | 111% | 176 | △ 弱い |
| **10月** | **35%** | 96 | ✗ 非常に悪い |
| **11月** | **59%** | 123 | ✗ 悪い |

→ **月10・11は明確なNO_BUYシグナル**。既存のNO_BUYフィルター (月1-3, 9除外) に加え、月10+11の除外を推奨。

### 総括: 推奨アクション

**すぐにpaper検証すべき条件 (最優先)**:

1. `新NO_BUY残り×月4+6+8+12×racerTop3>=0.5` (n=539, ROI=193%, test=297%, 2024=178%, 2025=213%)
   - 理由: 両年安定、test強い、nが大きい
   - 月4+6+8+12 = 春/初夏/秋口/冬 の4ヶ月のみBUY

2. `新NO_BUY残り×月4+6+12` (n=353, ROI=225%, 2024=216%, 2025=239%)
   - 理由: 最高ROI、2025年の方がさらに良い傾向
   - 月4+6+12 = 春/初夏/師走 の3ヶ月のみBUY (月8除外が効果的)

3. `新NO_BUY残り×月4+6+8+12×odds>=30` (n=515, ROI=184%, test=322%, 2024=171%, 2025=201%)
   - 理由: test最強(322%)、odds>=30フィルター付き

**次にNO_BUY追加を検討すべき条件**:
- 月10+11 → 両月ともROI<70%。既存フィルターに追加を推奨
- 月5+7 → ROI=111-117%で弱い。追加除外するとROIが大幅向上

### Rule suggestions 追記

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 月10を新NO_BUY条件に追加 (ROI=35%) | candidate | analyze-roi-decision-lab 系統的 | multiFilter5確認済み。月10除外でROI大幅向上 | dry-run後 |
| 月11を新NO_BUY条件に追加 (ROI=59%) | candidate | analyze-roi-decision-lab 系統的 | 月10と同時に除外で効果 | dry-run後 |
| 新NO_BUY残り×月4+6+8+12×racerTop3>=0.5 | candidate | analyze-roi-decision-lab 2024=178%/2025=213%/test=297% | paper検証推奨 | 月次レビュー |

---

## 2026-06-08 全探索セッション — 最終追記

### セッション概要

overnight自律分析（5h相当）の継続セッション。未探索次元を網羅的に探索し、S/A候補が108→120条件に増加。

### 今回新発見のA判定条件 (重要度順)

| 条件 | n | ROI | 2024 | 2025 | 評価 |
|---|---|---|---|---|---|
| 新NO_BUY残り×月4+6+12×**motor<40** | 302 | **236.7%** | 219% | 262% | ★★★ 両年上昇トレンド |
| 新NO_BUY残り×月4+6+12×**parts=0** | 343 | **231.1%** | 224% | 242% | ★★★ 両年>200%、部品交換なし |
| 新NO_BUY残り×月4+6+8+12×**selectedMotorLow=0** | 403 | **218.6%** | 180% | 273% | ★★★ 2025急上昇 |
| 新NO_BUY残り×月4+6+8+12×**motor<40×racerTop3>=0.5** | 457 | 187.5% | 165% | 217% | ★★★ n大きく安定 |
| 新NO_BUY残り×月4+6+8+12×**boat<40** | 459 | 182.4% | 154% | 225% | ★★★ n大きく安定 |
| 新NO_BUY残り×月4+6+8+12×**boat<40×racerTop3>=0.5** | 438 | 184.8% | 154% | 229% | ★★★ n大きく安定 |
| 新NO_BUY残り×月4+6+8+12×**parts=0** | 543 | 199.1% | 195% | 204% | ★★★ n最大+両年ほぼ均等(最安定!) |
| 新NO_BUY残り×月4+6+8+12×**parts=0×motor<40** | 460 | 201.0% | 188% | 219% | ★★★ 複合で安定 |
| **raceNo<=3 OR raceNo>=10 NO_BUY** | 2226除外 | afterROI=86.75% | - | - | ★★ 序盤+終盤除外+6.37% |

### 月4+6+12×motor<40 の深掘り結果

`月4+6+12×motor<40` (A判定, n=302, ROI=236.7%) のsub-filter上位:

| サブ条件 | n | ROI | 2024 | 2025 |
|---|---|---|---|---|
| wind>=5 | 89 | 274% | 221% | 336% |
| wave>=5 | 63 | 264% | 303% | 215% |
| odds>=50 | 83 | 369% | 271% | 455% |
| exSt<0.08 | 100 | 256% | 180% | 359% |
| 丸亀 (n=14) | 14 | **816%** | 766% | 942% |
| 蒲郡 (n=16) | 16 | **709%** | 848% | 626% |
| 唐津 (n=14) | 14 | **611%** | 316% | 1005% |

→ motor<40×丸亀/蒲郡/唐津は両年ともROI>300%だが、n=14-16でC判定。

### 月4+6+12×parts=0 の深掘り結果

`月4+6+12×parts=0` (A判定, n=343, ROI=231%) のsub-filter上位:

| サブ条件 | n | ROI | 2024 | 2025 |
|---|---|---|---|---|
| wind>=5 | 101 | 278% | 247% | 320% |
| motor<40 | 293 | 244% | 228% | 266% |
| odds>=50 | 93 | 329% | 235% | 417% |
| 丸亀 | 16 | 714% | 696% | 754% |
| 蒲郡 | 20 | 567% | 565% | 569% |

→ parts=0でも丸亀・蒲郡の強さは維持。motor<40との組み合わせも安定。

### 2026年データ状況

- 2026年のbackfill BUYデータ: **わずか44件** (全6260件の0.7%)
- 2026-06: result=0件（未集計）
- **結論**: 2026年統計は信頼性なし。年別分析は2024/2025のみ参照すべき

### 探索した次元の網羅状況

| 次元 | 探索状況 | 主な結果 |
|---|---|---|
| 月別フィルター | ✅ 完全 | 月4+6+12がコア、月8=低め、月10+11=NO_BUY |
| レース番号 | ✅ 完全 | raceNo>=10 NO_BUY確認済み、raceNo<=3 NO_BUYも有効 |
| 会場 | ✅ 完全 | 戸田/多摩川 NO_BUY、丸亀/蒲郡 特に高ROI |
| F回数 | ✅ 完全 | F>=1 NO_BUY確認済み |
| 風速 | ✅ 完全 | wind<3 NO_BUY、wind>=5 KEEP正 |
| exSt値 | ✅ 完全 | 0.10-0.15 NO_BUY deadzone確認 |
| モーター勝率 | ✅ 完全 | motor<40 KEEP正（逆張り効果） |
| 艇勝率 | ✅ 完全 | boat<40 KEEP正（同上） |
| レーサートップ3率 | ✅ 完全 | racerTop3>=0.5 KEEP正 |
| オッズ帯 | ✅ 完全 | odds>=30/50 KEEP正 |
| 波高 | ✅ 部分 | wave>=5 でROI上昇傾向（C判定） |
| 展示順位 | ✅ 探索 | exRank<=2,3 C判定（n<100） |
| 部品交換数 | ✅ 完全 | parts=0 KEEP正・A判定（新発見！） |
| チルト | ✅ 探索 | tilt=0 vs non-0: B判定 NO_BUY |
| 展示タイム | ✅ 探索 | exTime<6.70: B/C判定（n不足） |
| 選択モーター低数 | ✅ 完全 | selectedMotorLow=0 KEEP正・A判定 |
| 平均ST | △ 部分 | racerAvgSt<0.15 B判定（月別不安定） |
| レーン | ✅ 完全 | 98%が1-2-3固定のため分析不要 |
| 2026年データ | ✅ 確認 | 44件のみ、統計的に信頼性なし |

### 最終推奨候補 (新規追加)

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 新NO_BUY残り×月4+6+12×motor<40 (n=302, ROI=236%) | candidate | 両年219%/262%+上昇トレンド | paper検証最優先 | 月次レビュー |
| 新NO_BUY残り×月4+6+12×parts=0 (n=343, ROI=231%) | candidate | 両年224%/242%安定 | paper検証優先 | 月次レビュー |
| 新NO_BUY残り×月4+6+8+12×parts=0 (n=543, ROI=199%) | candidate | 両年195%/204%ほぼ均等(最安定) | paper検証・n大きく実用的 | 月次レビュー |
| 新NO_BUY残り×月4+6+8+12×selectedMotorLow=0 (n=403, ROI=218%) | candidate | 2025急上昇=273% | paper検証 | 月次レビュー |
| 新NO_BUY残り×月4+6+8+12×boat<40 (n=459, ROI=182%) | candidate | 両年安定・n大 | paper検証 | 月次レビュー |
| raceNo<=3 OR raceNo>=10 NO_BUY (+6.37%) | candidate | 序盤+終盤除外で安定改善 | 既存フィルターに追加検討 | dry-run後 |

## 2026-06-14 auto candidate review

### Source

- period: 2026-05-16..2026-06-14
- generatedAt: 2026-06-14T13:00:04.052Z
- BUY: 47
- settledBUY: 44
- hits: 2
- ROI: 0.748

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 多摩川 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 常滑 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 徳山 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| 桐生 はS条件のみ通知候補。A/Bは通知対象外に寄せる。 | watch | report:monthly | 追加観察 | next weekly |
| S帯が弱い。S条件の過学習、オッズ閾値、sample_size条件を再確認する。 | watch | report:monthly | 追加観察 | next weekly |

## 2026-06-21 auto candidate review

### Source

- period: 2026-05-23..2026-06-21
- generatedAt: 2026-06-21T13:00:04.270Z
- BUY: 1
- settledBUY: 0
- hits: 0
- ROI: -

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 確定BUYが20件未満。ルール変更は急がず、紙上観察を継続する。 | watch | report:monthly | 追加観察 | next weekly |

## 2026-06-28 auto candidate review

### Source

- period: 2026-05-30..2026-06-28
- generatedAt: 2026-06-28T13:00:05.380Z
- BUY: 0
- settledBUY: 0
- hits: 0
- ROI: -

### Rule suggestions

| rule | status | evidence | action | next_check |
|---|---|---|---|---|
| 確定BUYが20件未満。ルール変更は急がず、紙上観察を継続する。 | watch | report:monthly | 追加観察 | next weekly |

