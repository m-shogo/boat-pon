# 運用手順（2026-10-15 改訂・最小構成）

ふだんは launchd が全部を自動で回す。人がやるのは、LINE の「⚠️ 注意」を見て、出たら下の「困ったとき」に従うことだけ。

## 守ること

- 自動投票・自動購入・ログイン情報の保存・投票サイトの操作はしない。BUY は検証の候補で、購入指示ではない。
- 判定ロジック（`judgeCandidate`）と `app_settings` は、ユーザーの承認なしに変えない。
- ROI は**公式の払戻**（`race_results.payout_yen`）で出す。表示オッズ（`current_odds`）は確定払戻より楽観的なので根拠にしない。
- `data/` と `backups/` は消さない。`.env`・`*.sqlite`・秘密情報は Git に入れない。

## 自動で動くもの

[`README.md`](../README.md) の表のとおり。plist の控えは [`docs/launchd/`](launchd/)。

毎日の確認は LINE だけでよい:

- 🔔 BUY（締切の5分以上前）→ ✅/❌（21:30 までに）→ 📊 日次まとめ（21:30、収支と注意つき）
- 📈 週次まとめ（月曜 09:00、先週との比較）
- 日次まとめに「⚠️ 注意」が出たら、下の表で対応する。注意は「対応が要るもの」だけが出る（変わらない事実はスコアカードの「既知の状態」）

詳しい数字は `data/reports/scorecard/latest.md`（毎晩更新）。

## 困ったとき

| 注意・症状 | 原因の候補 | 対応 |
|---|---|---|
| T-5 のカバー率が低い・記録できたレースが少ない | ノートPCのスリープ（蓋を閉じた） | 8〜21時は AC 電源につないで開けておく。根本対策は常時起動の機械（方針の文書） |
| ジョブ ○○ が動いていない | launchd の登録が外れた・スリープ | `launchctl list \| grep boatpon` で確認し、`docs/launchd/` の plist で登録し直す |
| 判定までの遅れ・読み込みが目安を超えた | 全期間を読む処理が混ざった、DB の肥大 | `data/logs/auto-odds.log` の `decision-phase:` の `phaseMs` で、どの区間が長いかを見る |
| 送れていない LINE 通知がある | トークンの期限切れ・通信の失敗 | `npx tsx scripts/notify-line.ts test --dry-run` で設定を確認し、`.env` のトークンを更新する |
| 結果・払戻・番組表の最終日が遅れている | 公式アーカイブの公開遅れ・取得の失敗 | 翌日の自動の取り直しを待つ。続くなら `npm run fetch:official-results -- <開始日> <終了日>` |
| ディスクの空きが少ない | DB・ログ・バックアップの増加 | `backups/` の古い世代を、ユーザーが判断して外部ディスクへ移す（自動では消さない） |
| DB のバックアップが古い | バックアップの仕組みが止まっている | 方針の文書の「バックアップ」を見て、ユーザーが保存先と頻度を決める |

## コマンド

```sh
npm run verify                      # 型チェック・テスト・画面のビルド
npm run health                      # DB・ジョブ・バックアップの点検
npm run report:accuracy-scorecard   # 当たり外れ・精度・収集・見張り
npm run report:growth               # 1週間前・1か月前・半年前との比較
npm run audit:data-integrity        # 過去データの監査
npm run backup:safe                 # DB のバックアップ（VACUUM INTO で backups/ に保存）
npx tsx scripts/notify-line.ts daily --date YYYY-MM-DD --preview   # 日次まとめの文面の確認（送らない）
```

## LINE の設定

LINE Messaging API の push message を使う。秘密情報は repo 直下の `.env`（Git に入れない）。項目は `.env.example` を参照:

- `BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN` / `BOAT_PON_LINE_TO`
- `BOAT_PON_LINE_DRY_RUN`（任意）/ `BOAT_PON_LINE_ENDPOINT`（任意）

文面は `src/domain/lineMessages.ts`（BUY・日次・週次）と `src/domain/buyResultNotification.ts`（結果）。送信に失敗したものは `notification_log` に `FAILED` で残り、次の回に送り直す。BUY 通知の「投票」は BOAT RACE のシンプル投票サイト `https://bu.tbbr.jp/` に固定している（購入はしない）。

## 変更を本番に入れるとき

[`CLAUDE.md`](../CLAUDE.md) の「6. 作業コピーと反映」に従う。worktree で開発し、テストを通して、ライブ経路の変更はレースの無い 21:05〜07:30 にだけ反映する。

## 外したものを戻すとき

撤退前の研究コード・研究計画・旧レポートは、2026-10-15 に main から外した。タグ `archive/before-minimal-20261015` から1ファイルずつ戻せる（`git checkout archive/before-minimal-20261015 -- <path>`）。
