# Boat Pon

Boat Pon は、競艇の期待値通知アプリ「Boat EV Notifier」の個人用実装です。

自動購入・自動投票・ログイン情報保存・投票サイト操作は実装しません。  
BUY / WATCH / SKIP の判定、公式確認リンク、raw/JSON/SQLite保存、後日の検証を目的にします。

## 開発

```sh
npm install
npm run dev
```

`npm run dev` はローカルAPI (`http://127.0.0.1:5174`) と画面 (`http://127.0.0.1:5173`) を同時に起動します。

## データ取り込み

```sh
npm run db:init
npm run fetch:kyotei24
npm run import:kyotei24 -- YYYY-MM-DD
npm run import:official -- /path/to/program.csv
```

取得はキャッシュ前提です。`fetch:kyotei24` は同じ日のraw HTMLが新しければ再取得しません。
公式番組表はローカルCSV/TSVから取り込みます。外部サイトへの自動巡回は行いません。

## Phase 1 MVP

- kyotei24 結果ページを低頻度で取得して raw 保存
- raw HTML を normalized JSON へ変換
- SQLite へ保存
- ダッシュボードで結果と候補判定を表示
- 推定的中率、必要オッズ、EV、BUY / WATCH / SKIP を扱う
- 公式確認リンクは外部リンクのみ

## 安全仕様

- 自動購入なし
- 自動投票なし
- ログイン情報保存なし
- 投票サイト操作なし
- 全会場全レースの毎分取得なし
- オッズ全パターンの連打取得なし
- BUY候補なしの日を成功扱い
- Discord連携なし。通知はブラウザ通知ログを使う


## 現在できること

- 実HTMLからkyotei24結果をパースしてSQLiteへ保存
- ダッシュボードAPIで候補、結果、通知、バックテストを返す
- BUY候補だけ通知ログを作成し、重複通知を防止
- 手動オッズ入力をSQLiteへ保存し、判定に反映
- ブラウザ通知はボタン操作時のみ送信
- 設定画面で予算・目標EV・サンプル数条件を保存
- 日付指定で保存済みrawを再取り込み
- 公式番組表CSV/TSVをローカル取り込みし、履歴モデル候補を作成
- 実際に買った/買っていない履歴を手動記録
- EV別・会場別・過大評価候補をバックテスト表示
