# Real Fable Research Lab

## 結論

2026-07-18に、本物のFableコンパイラを使う表示専用の最小実装を導入した。
F#が既存データを表示向けのプレーンオブジェクトへ変換し、既存React画面が描画する。
ROI、BUY判定、仮説採否、設定、DBは変更・再計算しない。

## 実装構成

- `.config/dotnet-tools.json`: Fable 5.9.0をローカルツールとして固定
- `global.json`: .NET SDK 10.0.302を固定
- `src/renderers/fable-fsharp/FableRenderer.fsproj`: Fable.Core 5.2.0
- `src/renderers/fable-fsharp/Renderer.fs`: 表示専用のF#変換
- `src/renderers/fable-fsharp/generated/`: ビルド時に生成するJavaScript。型宣言だけを追跡
- `src/components/ResearchLab.tsx`: 生成JavaScriptを利用するReactホスト
- `GET /api/research/hypotheses`: `data/research-hypotheses.json`の読み取り専用API

Felizは導入していない。既存Reactを置き換えず、Fableの責務を小さなデータレンダラーに
限定したため、既存画面と段階的に併存できる。

## Research Labで見えるもの

- 仮説の継続中 / 棄却・凍結 / 全件フィルター
- 検証ゲート、既知の指標、データ準備状況
- 採用できない理由、次に行う研究、再確認トリガー
- 不足・追加確認データ
- candidate行数を番組レース数で割った候補多重度

候補多重度はBUYを増減させるロジックではない。1レースに複数候補が展開されている状態を
早期に発見し、live判定へ接続する前に「モデル最上位1件」のpaper検証を促す監査表示である。

## 安全境界

F#側は以下を行わない。

- ROI・スコア・ゲート・adoptionAllowedの再計算
- domain、server、scripts、SQLiteへの参照
- DB書き込み、設定変更、通知送信
- BUY/WATCH/SKIPやProduction昇格の判断

テストは入力済みの値が変わらないこと、依存禁止語がF#ソースへ混入しないこと、
棄却分類と候補多重度の表示変換を確認する。

## 開発コマンド

```sh
brew install dotnet
npm install
npm run fable:restore
npm run fable:build
npm test
npm run build
```

`npm test`と`npm run build`は先にFableをコンパイルする。CIでも同じ.NET SDKと
ローカルツールマニフェストを復元する。

## ロールバック

Researchナビゲーションと`ResearchLab`のimportを外し、package scriptsから
`fable:build`を外せば既存画面へ戻せる。FableはDB、判定、通知のコードを参照しないため、
表示層の撤去で完結する。

## 次の研究候補

DailyResearchReport aggregateとRule LifecycleのFable表示は未接続である。追加する場合も、
既存Presentation値を変更せず表示する範囲に限定する。ROI向上はResearch Labで仮説と不足データを
絞り、履歴・walk-forward・paper-forwardのゲートを通した後に別レビューで判断する。

### 候補選択監査

全出目候補とDBに残った候補の違いは、productionへ接続しない読み取り専用監査で確認する。

```sh
npm run audit:candidate-selection
npm run audit:candidate-selection -- --json
```

モデル最上位1件をpaper上で再判定し、現在DBに残った買い目との一致率、BUY/WATCH/SKIP件数、
買い目別オッズを比較する。この結果だけでlive判定へ接続してはいけない。

### Shadow top-1 backtest

買い目別オッズ、日付以前だけの180日学習、モデルtop-1を使い、公式払戻を主ROIとして評価する。

```sh
npm run backtest:shadow-top1
npm run backtest:shadow-top1 -- --from 2024-01-01 --to 2025-12-31 --json
npm run backtest:shadow-top1 -- --selector ev --from 2025-01-01 --to 2025-12-31
npm run backtest:shadow-top1 -- --edge-grid --from 2025-01-01 --to 2025-12-31 --json
```

最大高配当1件・2件除外ROI、年別ROI、最大ドローダウン、最大連敗を同時に出す。
`current_odds` ROIは補助値で、採否は公式払戻ROIを優先する。read-only shadowでありlive未接続。
`--selector model-score`はモデル確率top-1、`--selector ev`は判定statusとEVを使う研究比較。
どちらもhistorical latest oddsでありT-5再現ではない。
`--edge-grid`は事前固定したモデルEV閾値とオッズ上限を横並びにする。探索結果の最良値を
そのまま採用せず、別年とfuture-onlyで再検証する。
