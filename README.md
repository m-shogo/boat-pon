# Boat Pon

競艇の BUY 候補を LINE で知らせ、当たり外れと確率の精度を記録する個人用のツール。

**自動購入・自動投票・ログイン情報の保存・投票サイトの操作はしない（実装もしない）。** BUY は検証のための候補で、購入指示ではない。

## いまの状態（2026-10-15）

- **利益の edge は無いと確定し、撤退した（2026-10-07）。** 事前登録した検証で、市場（締切5分前のオッズ）に勝てなかった。根拠は [`docs/knowledge-base.md`](docs/knowledge-base.md)。
- 続けているのは、**当たり外れを正しく伝えること**と、**確率の精度を測ること**だけ。
- 2026-10-15 に、撤退前の研究基盤・研究コード・旧レポート（約 2,450 ファイル）を main から外した。外す前の状態はタグ `archive/before-minimal-20261015` にある（戻し方は下）。

## 動いているもの（launchd、本番の作業コピー `~/Developer/personal/boat-pon` をそのまま実行）

| ジョブ | いつ | すること |
|---|---|---|
| auto-odds | 08:00〜21:05、5分ごと | オッズ・直前情報の取得、判定（締め切りと通知で固定）、BUY の LINE 通知 |
| auto-exhibition | 30分ごと | 直前情報の一括取得 |
| daily-programs | 01:00〜07:30 | 番組表の取り込み |
| daily-results | 21:30 | 結果と全券種の払戻の取り込み、確定結果の通知 |
| daily-notify | 21:30 | スコアカード（精度・収集・ジョブの見張り）→ 今日の BUY の結果 → 日次まとめ（収支つき） |
| weekly-forward-notify | 月曜 09:00 | 先週と比べた成長のまとめ |
| daily-progress / weekly-racer-stats / caffeinate | — | 進捗ログ・選手データ・スリープ防止 |

plist の控えは [`docs/launchd/`](docs/launchd/)。運用の詳細は [`docs/operation.md`](docs/operation.md)。

## コマンド

```sh
npm ci                              # 依存を入れる（CI と同じ npm）
npm run verify                      # 型チェック・テスト・画面のビルド
npm run dev                         # 画面（http://127.0.0.1:5173）と API（:5174）
npm run report:accuracy-scorecard   # 当たり外れ・精度・収集・ジョブの見張り
npm run report:growth               # 1週間前・1か月前・半年前との比較
npm run audit:data-integrity        # 過去データの監査
npm run review:t5-residual          # 撤退の判定の再現（読み取り専用）
npx tsx scripts/notify-line.ts daily --date YYYY-MM-DD --preview   # LINE の文面の確認（送らない）
```

## 構成

- `scripts/` … 定期ジョブと、通知・取り込み・スコアカード・監査のスクリプト
- `src/domain/` … 判定・通知の文面・精度の計算などの純粋な処理（テストつき）
- `src/research-replay/` … T-5 のオッズの収集と市場の計算で、ライブ経路が使っている部分だけ
- `server/` と `src/`（画面）… ローカルの確認用の画面と API
- `data/` … DB・ログ・取得した元ファイル（Git に入れない。消さない）
- `docs/` … 知識ベース・運用・レビュー

## 外したものを戻す

```sh
git show archive/before-minimal-20261015 --stat        # 外す前の状態
git checkout archive/before-minimal-20261015 -- <path>  # 1ファイルだけ戻す
```

## 環境変数（`.env`、Git に入れない）

- LINE: `.env.example` を参照
- `BOAT_PON_API_PORT`: API のポート（既定 5174）
- `BOAT_PON_VAPID_PUBLIC_KEY` / `BOAT_PON_VAPID_PRIVATE_KEY` / `BOAT_PON_VAPID_SUBJECT`: 画面の Web Push（`npm run generate:vapid` で作る）
- `BOAT_PON_DB_URI`: 読み取り専用で DB を開くとき（例: `file:data/boat.sqlite?mode=ro`）
