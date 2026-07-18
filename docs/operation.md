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
```

送信内容:

- 自動オッズ取得後: 新規BUY候補をレースごとに即時通知（送信済みは重複送信しない）
- 21:30の日次サマリ: `BUY / WATCH / SKIP / odds coverage` と見送り理由TOP5
- 21:30時点で未送信のBUY候補がある場合: レースごとの個別通知
- 公式オッズURL
- `paper観察モード` 注記

`scripts/daily-notify.sh` は macOS 通知の前にLINE通知を試行する。LINE env が未設定ならスキップし、LINE送信に失敗しても macOS 通知は継続する。

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
| `pnpm notify:line:test` | LINE疎通テスト |
| `pnpm catchup` | 過去分取り込み |
