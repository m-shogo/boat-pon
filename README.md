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
npm run fetch:official-results -- 2025-11-21 2026-05-20   # 公式の競走成績(K)を期間指定で一括DL+取り込み
npx tsx scripts/fetch-official-odds.ts YYYY-MM-DD 蒲郡 8
```

公式競走成績の一括取り込みは LZH 圧縮を `unar` で解凍します。事前に `brew install unar` が必要です。礼儀として1.2秒/ファイルのsleepが挟まり、180日分でおおよそ4分です。一度DL済のLZHは再取得しません。

取得はキャッシュ前提です。`fetch:kyotei24` は結果ページのみ（同日 raw が新しければ再取得しません）。
リアルタイムオッズは公式 boatrace.jp の 3連単オッズページから取得します（`fetch-official-odds.ts`）。候補レース1件単位、キャッシュ5分、外部アクセスは画面の「公式オッズ取得」ボタン押下時か「自動取得 (60秒)」を明示的にONにした時のみ発火します。
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
- サンプル不足除外を明示した有効サンプル集計
- 今月のBUY/的中/ROI/買わない日数の月次サマリー
- 公式 boatrace.jp の3連単オッズをリアルタイム取得（候補レースのみ、5分キャッシュ、手動ボタン/自動60秒トグル）
- 公式 mbrace.or.jp の競走成績LZHを期間指定で一括DL+解凍+取り込み（Shift_JIS、unar依存）


## API一覧

- `GET /api/health`: API稼働確認
- `GET /api/dashboard?date=YYYY-MM-DD`: ダッシュボード、候補、結果、通知、節約、ROI集計
- `GET /api/results?date=YYYY-MM-DD`: 結果一覧
- `GET /api/history`: 判定履歴とバックテスト要約
- `PUT /api/settings`: 予算・EVなどの安全設定を保存
- `PUT /api/odds/:raceId`: 手動オッズ保存
- `POST /api/odds/fetch`: 候補レースのみ公式オッズ取得
- `POST /api/notifications/:id/send`: ブラウザ通知を送信済みにする
- `POST /api/import/official-local`: ローカル番組表データ取り込み
- `POST /api/import/reparse-kyotei24`: 保存済みrawを再パース
- `GET /api/export/results.csv`: 結果CSV
- `GET /api/export/history.csv`: 判定履歴CSV
- `GET /api/export/monthly.csv`: 月次CSV
- `GET /api/push/vapid-public-key`: Web Push公開鍵
- `POST /api/push/subscribe`: Web Push購読登録の受け口

## 判定ロジック差し替えインターフェース案

`judgeCandidate(candidate, rule, context)` と同じ入出力を持つ関数を plugin として扱う想定です。

```ts
export type JudgePlugin = {
  name: string;
  judge: typeof judgeCandidate;
};
```

まずは本体の安全条件を固定し、推定的中率モデルだけを差し替え可能にします。自動購入・投票操作を行うpluginは受け入れません。

## 環境変数

- `BOAT_PON_API_PORT`: APIポート。既定値は5174
- `BOAT_PON_DL_ONLY`: 将来のDL専用モード用フラグ
- `BOAT_PON_VAPID_PUBLIC_KEY`: Web Push公開鍵
- `BOAT_PON_VAPID_PRIVATE_KEY`: Web Push秘密鍵
- `BOAT_PON_VAPID_SUBJECT`: VAPID subject。例: `mailto:you@example.com`

VAPIDキーは `npm run generate:vapid` で生成できます。iOS SafariのWeb Pushは16.4以降で、ホーム画面に追加したWeb Appが対象です。

### Web Push設定手順

```sh
npm run generate:vapid
# 出力された BOAT_PON_VAPID_PUBLIC_KEY / PRIVATE_KEY / SUBJECT を .env.local などに保存
# dev/api を再起動
npm run dev
# 画面右下のSettings画面で「通知を購読する」→「テスト送信」で動作確認
```

VAPIDキー未設定時は `/api/push/vapid-public-key` が `{ enabled: false }` を返し、UIでも警告表示されます。VAPIDキーは秘密情報なのでGit管理しないでください。
