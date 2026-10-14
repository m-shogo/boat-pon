# 運用手順

## 基本方針

- **本番 decision ロジックは変更しない**
- **app_settings は変更しない**
- **自動投票・ログイン保存・投票サイト操作は禁止**
- BUY は購入指示ではなく検証候補
- ROI は `current_odds` 基準
- `*.sqlite` は git add しない
- `.env` や秘密情報は git add しない

---

## 日次運用

```bash
pnpm daily
pnpm catchup
pnpm backup
```

結果取得LaunchAgentは、公式結果アーカイブから昨日までの14日間を毎晩確認する。
既に公式結果がある日はスキップし、DNS/HTTP/parse失敗が1日でもあれば非0終了して
readinessの結果カバレッジとログに残す。kyotei24は日次結果の主経路には使わない。
番組表取得LaunchAgentも今日までの15日間を確認し、一時障害で欠けた日を同様に補完する。

---

## LINE通知

BUY候補や日次サマリをLINEへ送る。通知は**購入指示ではなくpaper検証候補の確認用**。
LINE Notify は提供終了済みのため、LINE Messaging API の push message を使う。

### envファイル

実運用の秘密情報は、repo直下の `.env` に置く。`.env` は `.gitignore` 対象なのでgitに入れない。
`.env.example` は項目名確認用の見本としてだけ使う。

`.env` に設定する項目:

- `BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN`
- `BOAT_PON_LINE_TO`
- `BOAT_PON_LINE_DRY_RUN`（任意）
- `BOAT_PON_LINE_ENDPOINT`（任意）

読み込み優先順位:

1. シェル環境変数
2. `.env`

### テスト

```bash
pnpm notify:line:test -- --dry-run
pnpm notify:line:test -- --message "Boat Pon LINE 通知テスト"
pnpm notify:line:daily -- --date 2026-06-29
pnpm notify:line:results -- --date 2026-06-29 --dry-run
```

送信内容（2026-10-14 時点。文面は `src/domain/lineMessages.ts` と `src/domain/buyResultNotification.ts`）:

- 🔔 BUY（auto-odds、8:00〜21:05 の5分ごと）: T-10 か T-5 で BUY になり、締切まで5分以上あるレースだけ、その場で送る。送ったら判定はそこで固定する。送らなかった BUY は理由をログに出す（`LINE realtime not-sent:`）
- ✅ 的中 / ❌ はずれ / ↩️ 返還（速報）: `scripts/notify-buy-results-fast.ts`。10分ごとの登録はユーザー作業。未登録でも、21:30 の日次まとめの前に `--catch-up` で、その日の BUY の結果を公式の結果ページで確かめて送る
- 📊 日次まとめ（21:30、`scripts/daily-line-summary.sh`）: 今日の BUY と当たり外れ・前日の結果・今月と通算・記録できたレース（番組数に対する判定と T-5 のオッズ）・スコアカードの注意
- 確定結果（21:30、`scripts/daily-results.sh` の K ファイル取り込み後）: 速報と同じ結果なら送らない
- 📈 週次まとめ（月曜 09:00、`scripts/weekly-forward-notify.sh`）: 先週とその前の週の比較
- 公式リンクと「※paper検証（実際の購入なし）」の注記

送信に失敗して `PENDING` に残った直近3日分は、次回の LINE 通知ジョブで再送する。`ENOTFOUND` / `EAI_AGAIN` の DNS 失敗は、5秒・15秒・30秒待って自動再試行する。

launchd用の通知・番組・結果補完スクリプトは、Corepack/pnpmの外部メタデータ取得を避け、ローカルの`node --import tsx`を`mise`経由で実行する。これによりnpmレジストリのDNS障害をLINE/API障害と混同しない。

BUY通知の「投票サイト」は、公開仕様のないレース別deep linkを組み立てず、BOAT RACEが案内するシンプル投票サイト`https://bu.tbbr.jp/`へ固定する。別行の「公式」は対象レースの3連単オッズページを維持する。

リアルタイムBUY通知は、途中オッズで一時的にBUYとなる誤通知を減らすため、対象買い目の最新時系列checkpointが`T-10`か`T-5`で、締切5分以上前の場合だけ送る（2026-10-14 までは T-5 のみ。T-10 で BUY になったレースの次の実行が締切5分前を過ぎ、通知できない例が続いたため T-10 を足した）。収集自体は締切1分前まで続けるが、5分未満では購入余裕がないため通知しない。判定ロジック自体は変更しない。

---

## ROI 分析

```bash
pnpm analyze:roi-decision-lab
pnpm paper:forward
```

`paper:forward` は paper 追跡用で、本番 BUY/NO_BUY 判定には影響しない。
本番反映は forward n、roiExMaxHit、対象月の分散を確認してから行う。

---

## 分析スクリプト一覧

| コマンド | 説明 |
|---|---|
| `pnpm analyze:roi-decision-lab` | ROI全条件ラボ |
| `pnpm paper:forward` | Paper forward test 記録・レポート更新 |
| `pnpm backup` | DB バックアップ |
| `pnpm daily` | 日次処理 |
| `pnpm notify:line:daily` | LINE日次サマリ + BUY個別通知 |
| `pnpm notify:line:results` | 結果確定済みpaper-live BUYの的中/外れ・公式払戻・100円仮想損益 |
| `pnpm notify:line:test` | LINE疎通テスト |
| `pnpm catchup` | 過去分取り込み |
