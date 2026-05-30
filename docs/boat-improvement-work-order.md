# Boat Pon 改善作業指示

最終更新: 2026-05-30

## 目的

Boat Pon は自動購入・自動投票アプリではない。
目的は、競艇の3連単について「買うべきレースを増やす」ことではなく、**ほとんどの日を見送り、数字的に割に合う可能性がある候補だけを見つけること**。

現在の改善方針は、モデルのパラメータを無理に変えることではなく、以下を厚くすること。

1. データ品質の可視化
2. paper live 観察の自動診断
3. walk-forward / out-of-sample 検証の見える化
4. 弱いルールを安全に見つける集計
5. 通知・日次締めの停止検知

---

## 現状認識

- 現行モデルは `boatpon-v3-alpha15`。
- v4-conservative は検証済みで不採用。
- 2020-2023 外部検証で ROI はランダムより改善しているが、breakeven には届いていない。
- 2026 年以降は paper live 観察扱い。実購入判断には使わない。
- n < 300 の間は、ROI が良く見えても購入判断しない。

---

## 絶対禁止

以下は実装しない・実行しない。

- 自動購入
- 自動投票
- ログイン情報保存
- 投票サイト操作
- 外部サイトへの大量アクセス
- `data/` 配下のコミット
- `.claude/` 配下のコミット
- 2026 年 live `decision_history` への書き込み
- `app_settings` の無断変更
- `payout_yen` ベースの ROI 検証

ROI 検証は必ず `current_odds` ベースで行う。

---

## 優先度S: 今すぐ作る価値が高い改善

### S-1. データ品質・カバレッジ診断CLIの強化

目的:

今日の候補が出ない理由を、モデルが弱いのか、データが足りないのか、取得が止まっているのかに分解する。

既存コマンド:

```sh
npm run db:health
npm run stats:racer-coverage
npm run live:diagnose -- --json
npm run status:brief -- --json
```

追加したい出力:

- 今日の出走選手数
- racer profile coverage
- racer course stats coverage
- odds snapshot coverage
- program coverage
- result coverage
- BUY / WATCH / SKIP 件数
- WATCH → BUY までの不足オッズ差
- 取得停止っぽい場合の warning

出力例:

```json
{
  "date": "2026-05-30",
  "programCoverage": 0.98,
  "racerProfileCoverage": 0.91,
  "courseStatsCoverage": 0.42,
  "oddsCoverage": 0.76,
  "buyCount": 0,
  "watchCount": 4,
  "nearestWatchToBuy": {
    "raceId": "20260530-gamagori-8",
    "selection": "1-2-3",
    "currentOdds": 24.8,
    "requiredOdds": 25.0,
    "gap": 0.2
  },
  "action": "wait_data_or_odds"
}
```

受け入れ条件:

- 読み取り専用であること
- `--json` に対応すること
- BUY=0 を失敗扱いしないこと
- 取得停止・データ不足・単純に条件未達を分けること

---

### S-2. paper live 日次レポートCLI

目的:

毎日見るべき内容を1コマンドで確認できるようにする。

追加候補:

```sh
npm run report:daily -- --date 2026-05-30
npm run report:daily -- --date 2026-05-30 --json
```

中で読むもの:

```sh
npm run status:brief -- --json
npm run live:diagnose -- --json
npm run watch:today -- --json
npm run day:close -- --json
npm run stats:racer-coverage -- --json
```

出力に含めるもの:

- 今日の状態: ok / waiting / warn
- BUY 候補数
- WATCH 候補数
- BUY=0 の理由
- オッズ取得率
- 選手データ coverage
- 今日やること
- 実購入禁止の注意

表示例:

```txt
Boat Pon Daily Report 2026-05-30
status: waiting

BUY: 0
WATCH: 4
odds coverage: 76%
racer course coverage: 42%

reason:
- BUY条件を満たす候補なし
- WATCH候補はあるが required odds に届かない

next action:
- 今日は待ち
- 設定変更しない
- 21:05以降に npm run day:close を確認
```

受け入れ条件:

- 外部取得しない
- DBへ書き込まない
- 既存CLIのJSONを合成するだけにする
- 終了コードを `0=正常`, `1=警告`, `2=異常` で分ける

---

### S-3. walk-forward 検証レポート

目的:

「たまたま当たった」ではなく、期間をずらしても期待値が残るかを確認する。

追加候補:

```sh
npm run evaluate:walk-forward -- --from 2022-01-01 --to 2025-12-31 --train-days 180 --test-days 30 --step-days 30 --json
```

比較したい条件:

- train-days: 90 / 180 / 365
- test-days: 7 / 30
- step-days: 7 / 30
- odds band: 20-30 / 30-50 / 50-100
- venue
- class
- raceNo
- month

出力例:

```json
{
  "config": {
    "trainDays": 180,
    "testDays": 30,
    "stepDays": 30
  },
  "summary": {
    "n": 420,
    "hitRate": 0.031,
    "roi": 0.94,
    "roiExMax": 0.81,
    "maxDrawdownMonths": 4
  },
  "scoreBands": [
    { "band": "A", "n": 80, "roi": 1.03, "roiExMax": 0.91 },
    { "band": "B", "n": 190, "roi": 0.92, "roiExMax": 0.78 }
  ],
  "weakRules": [
    { "rule": "odds 50-100", "n": 120, "roi": 0.71, "reason": "overestimated" }
  ]
}
```

受け入れ条件:

- 2026年以降はデフォルト除外
- `--include-live` がない限り 2026 年を読まない
- DBへ書き込まない
- `current_odds` ベースで ROI を計算
- 最大払戻1件を除外した `roiExMax` を必ず出す

---

## 優先度A: Sのあとにやる改善

### A-1. 弱いルール候補の自動抽出

目的:

人間がグラフを眺めて勘で判断するのではなく、弱そうな条件を候補として出す。

集計軸:

- odds band
- required odds band
- odds ratio band
- venue
- raceNo
- month
- class
- program category
- first boat national win rate band
- second boat class

ただし、自動で設定変更はしない。

出力例:

```txt
Weak rule candidates

1. venue=戸田
   n=82 / roi=0.42 / roiExMax=0.31
   action: keep excluded, no change needed

2. oddsBand=50-100
   n=120 / roi=0.71 / roiExMax=0.55
   action: monitor only, do not exclude yet
```

受け入れ条件:

- n が少ないルールは候補に出さない
- `n < 50` は low sample と表示
- 自動で `app_settings` を変えない
- 「採用」ではなく「調査候補」として表示

---

### A-2. Live Monitor UI の改善

目的:

画面だけ見ても、今が「正常な待ち」なのか「取得停止」なのか分かるようにする。

追加したい表示:

- paper live 明示バッジ
- BUY n / 300 進捗
- live ROI / roiExMax
- 今日の BUY / WATCH / SKIP
- データ coverage
- 取得停止 warning
- 実購入禁止の注意

画面文言例:

```txt
paper live観察中
n=300に達するまで購入判断しません。
現在のBUY n: 12 / 300
```

受け入れ条件:

- UI変更のみ
- 設定変更なし
- 外部取得なし
- 実購入を促す文言を入れない

---

### A-3. テスト追加

優先してテストするもの:

- ROI計算
- roiExMax計算
- odds band 分類
- coverage分類
- BUY=0時の status 判定
- 2026 live 除外ガード
- payout_yen を使っていないこと

例:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateRoiExMax } from './roi';

test('roiExMax excludes largest payout', () => {
  const bets = [
    { stake: 100, returnAmount: 0 },
    { stake: 100, returnAmount: 300 },
    { stake: 100, returnAmount: 1200 },
  ];

  assert.equal(calculateRoiExMax(bets), 1.5);
});
```

---

## 作業前チェック

Codex / Claude Code に渡す前に、必ず以下を読む。

```sh
cat README.md
cat docs/model-roadmap.md
cat docs/claude-next-work-order.md
cat docs/lessons-learned.md
```

作業開始前に実行してよいもの:

```sh
npm run typecheck
npm test
npm run guard:live
npm run status:brief -- --json
```

大量取得・DB書き込み・2026 live 書き込みはしない。

---

## Codex に渡す用プロンプト

以下をそのまま渡す。

```txt
boat-pon の改善をお願いします。

最初に README.md、docs/model-roadmap.md、docs/claude-next-work-order.md、docs/lessons-learned.md、docs/boat-improvement-work-order.md を読んでください。

絶対禁止:
- 自動購入、自動投票、ログイン保存、投票サイト操作を実装しない
- 外部サイトへの大量アクセスをしない
- data/ と .claude/ をコミットしない
- 2026年 live decision_history に書き込まない
- app_settings を勝手に変更しない
- ROI検証に payout_yen を使わない。current_odds ベースに統一する

今回やること:
1. 既存CLIを確認し、読み取り専用の日次診断CLI `report:daily` を追加してください。
2. `report:daily --json` に対応してください。
3. 出力には BUY/WATCH件数、BUY=0の理由、odds coverage、racer coverage、day close status、next action を含めてください。
4. DB書き込み・外部取得はしないでください。
5. 既存の `status:brief`, `live:diagnose`, `watch:today`, `day:close`, `stats:racer-coverage` のロジックをなるべく再利用してください。
6. 可能なら ROI / roiExMax の純粋関数テストを追加してください。

完了条件:
- npm run typecheck が通る
- npm test が通る
- npm run build が通る
- npm run guard:live が危険変更なしで通る
- npm run report:daily -- --date YYYY-MM-DD と --json が動く

実購入判断に使える表現は避け、paper live 観察用であることを明示してください。
```

---

## 中学生でも分かる説明

今は、競艇で「本当に勝てるルール」を探している途中。

でも、まだデータが少ないから、いきなりお金をかけるのは危ない。

だから次にやるべきことは、予想を強くするというより、

- データがちゃんと集まっているか
- 予想が外れた理由は何か
- たまたま当たっただけではないか
- 長い期間で見ても強いか

を毎日チェックできるようにすること。

つまり、今作るべきなのは「強そうに見える予想」ではなく、**嘘の強さを見抜く道具**。

これができると、将来データが300件以上たまった時に、かなり安全に判断できる。
