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
`data/` 配下のraw HTMLやSQLiteはViteの依存スキャン・監視対象から外しています。

push前の標準確認:

```sh
npm run verify
```

DB診断とlive監視、secret scanまで含める場合:

```sh
npm run verify:full
```

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
- ROI集計は公式払戻ではなく、判定時に保存した取得オッズを使って検証
- 公式 boatrace.jp の3連単オッズをリアルタイム取得（候補レースのみ、5分キャッシュ、手動ボタン/自動60秒トグル）
- 公式 mbrace.or.jp の競走成績LZHを期間指定で一括DL+解凍+取り込み（Shift_JIS、unar依存）
- 読み取り専用のデータ品質チェック、週次/月次レポート、期間ずらし検証、通知dry-runをCLIで確認

## 運用メモ

- モデル改善の順序と採用基準: [docs/model-roadmap.md](docs/model-roadmap.md)
- v4保守モデル検証: [docs/v4-conservative-validation-2026-05-26.md](docs/v4-conservative-validation-2026-05-26.md)
- Claude Code 次作業指示: [docs/claude-next-work-order.md](docs/claude-next-work-order.md)
- live設定変更前の安全ゲート: [docs/settings-change-gate.md](docs/settings-change-gate.md)
- 失敗・学びの蓄積: [docs/lessons-learned.md](docs/lessons-learned.md)
- データ取得ロードマップ: [docs/data-roadmap.md](docs/data-roadmap.md)

### 毎日の読み取り専用チェック

通常は、まず短い状態確認とデータ品質を見る。

```sh
npm run status:brief
npm run report:daily
npm run validate:data
npm run decision:dry-run
```

- `status:brief`: 今日の監視状態と次に取るべき操作を短く確認する。
- `report:daily`: 番組、オッズ、判定、選手データ鮮度、今日の選手カバレッジ、未実装データを1コマンドで確認する。`--json` と `--date YYYY-MM-DD` に対応する。
- `validate:data`: DB、主要テーブル、データ鮮度、選手成績カバレッジ、BUY行の欠損を確認する。
- `decision:dry-run`: 実通知を送らず、今日の候補を `send` / `watch` / `skip` に分けて理由を見る。

BUY候補が少ない日は異常扱いしない。まず `status:brief` の `action:` と `report:daily` の `Alerts` を優先し、必要な時だけ詳細を見る。

### 週次・月次の検証

```sh
npm run report:weekly
npm run report:monthly
npm run walk:history -- --from 2026-01-01 --to 2026-05-30
```

- `report:weekly`: 直近7日をシグナル帯、会場、レース番号別に確認する。
- `report:monthly`: 直近30日で、BUY数、的中率、ROI、弱い条件候補を見る。
- `walk:history`: 期間をずらしながら、特定の月だけたまたま良かったルールを見抜く。

ROIが良い条件を見つけても、すぐlive設定へ反映しない。月別、会場別、レース番号別、期間ずらしで崩れないか確認してから採用候補にする。

読み取り専用のv4保守モデル診断:

```sh
npm run db:health
npm run evaluate:v4 -- --from 2025-01-01 --to 2025-01-31 --limit 500
```

`evaluate:v4` は `data/boat.sqlite` を読み取るだけで、`decision_history` へ書き込みません。検証ROIは判定時点の `current_odds` 基準です。

### データカバレッジ確認

追加データ取得やモデル改善に進む前に、現在のDBが `docs/data-roadmap.md` の7項目をどれだけ満たしているか確認する。

```sh
npm run report:data-coverage
npm run report:data-coverage -- --json
```

- `report:data-coverage`: 結果データ、締切直前オッズ、オッズ比、水面条件、展示タイム、チルト/部品交換、モーター/ボート成績を `OK` / `PARTIAL` / `MISSING` で確認する。
- `--json`: 自動監視やCodex/Claudeへの引き継ぎに使いやすいJSON形式で出力する。
- このコマンドは読み取り専用で、外部サイトへの追加アクセス、自動投票、DB書き込み、live設定変更は行わない。
- 詳細な保存方針と優先順位は [docs/data-roadmap.md](docs/data-roadmap.md) を参照する。

paper live観察の進捗確認:

```sh
npm run status:brief
npm run live:diagnose
npm run watch:today
npm run progress
npm run readiness
npm run day:close
npm run guard:live
```

`status:brief` は監視用の短い要約です。末尾の `action:` 行が次に取るべき操作を示すので、通常はこれだけを見て、`run npm run readiness` / `inspect git diff` 以外の場合はそのまま待機します。`--json` オプション (`npm run status:brief -- --json`) を付けると同じ内容を JSON 1行で出力します（Codex などの自動監視向け）。
`live:diagnose` はBUY=0を「待ち」と決めつけず、当日の取得窓、オッズ取得率、WATCH→BUY境界差、必要オッズ以上なのにSKIPされた行を分解して表示します。読み取り専用で、`--json` オプション (`npm run live:diagnose -- --json`) に対応します。
`watch:today` は当日の `WATCH` / `BUY` 候補だけを短く表示します。これは紙上観察用の読み取り専用コマンドで、実購入判断や設定変更には使いません。`--json` オプション (`npm run watch:today -- --json`) で自動監視向けのJSON 1行を出力します。
`progress` は live BUY進捗、番組/判定/オッズの最終日、オッズ取得率、BUY=0継続の早期警告、n=300到達ETA、ログ末尾をまとめて表示します。実購入判断には使わず、情報取得が止まっていないかを見るためのコマンドです。
`readiness` はLaunchAgent時刻、DB鮮度、ログ作成状況を読み取り専用で確認します。`--json` オプション (`npm run readiness -- --json`) で同じ内容をJSON 1行で出力します。
`guard:live` は未コミット差分を読み取り、live判定・設定・DB/data混入に触れる変更があれば停止します。Claude/Codexに作業を渡す前後の安全確認に使います。
`day:close` は21:05以降に「今日の収集は締められたか」を短く確認します。`close_status: ok / waiting / warn` と次の操作を10行程度で表示します。`--json` オプション (`npm run day:close -- --json`) で自動監視向けのJSON 1行を出力します。

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

`npm run handoff:claude` でClaude向け作業引き継ぎ指示（制約・現在状態・作業範囲）を出力します。
