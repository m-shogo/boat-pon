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
