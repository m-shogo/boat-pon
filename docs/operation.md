# 運用手順

## 基本方針

- **本番 decision ロジックは変更しない**
- **app_settings は変更しない**
- **自動投票・ログイン保存・投票サイト操作は禁止**
- BUY は購入指示ではなく検証候補
- ROI は `current_odds` 基準（`payout_yen` は使わない）
- `*.sqlite` は git add しない
- `.env` や秘密情報は git add しない

---

## 日次運用

### daily 実行

```bash
pnpm daily
```

### catchup（過去分取り込み）

```bash
pnpm catchup
```

### DB バックアップ

```bash
pnpm backup
```

---

## LINE通知

### 目的

BUY候補や日次サマリをLINEへ送る。通知は**購入指示ではなくpaper検証候補の確認用**。
`notification_log` の `channel='line'` を使い、同一 `race_id` は送信済みなら再送しない。

LINE Notify は提供終了済みのため、LINE Messaging API の push message を使う。

### 必須環境変数

```bash
export BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN="<Messaging API channel access token>"
export BOAT_PON_LINE_TO="<userId or groupId or roomId>"
```

複数宛先に送る場合:

```bash
export BOAT_PON_LINE_TO="Uxxxx,Cxxxx,Rxxxx"
```

### 任意環境変数

```bash
# 実送信せず、送信内容だけ表示
export BOAT_PON_LINE_DRY_RUN=1

# 通常は不要。テスト用エンドポイント差し替え
export BOAT_PON_LINE_ENDPOINT="https://api.line.me/v2/bot/message/push"
```

### テスト送信

まずdry-runで本文を確認する。

```bash
pnpm notify:line:test -- --dry-run
```

実送信する場合:

```bash
pnpm notify:line:test -- --message "Boat Pon LINE 通知テスト"
```

### 日次サマリ + BUY個別通知

```bash
pnpm notify:line:daily -- --date 2026-06-29
```

送信内容:

- 日次サマリ: `BUY / WATCH / SKIP / odds coverage`
- BUY候補がある場合: レースごとの個別通知
- 公式オッズURL
- `paper観察モード` 注記

### daily-notify.sh 連動

`scripts/daily-notify.sh` は macOS 通知の前に以下を実行する。

```bash
pnpm --silent notify:line:daily -- --date "$TODAY"
```

LINE env が未設定ならスキップ。LINE送信に失敗しても macOS 通知は継続する。

---

## ROI 分析

### 全条件ラボ分析（S/A/B判定）

```bash
pnpm analyze:roi-decision-lab
# → reports/roi-decision-lab.md / .json を生成
```

実行時間: 数分。read-only。DB は変更しない。

---

## Paper Forward Test — 月4+6+8+12×parts=0

### 目的

`月4+6+8+12×parts=0` 条件（seasonal_parts0_month_4_6_8_12）の過去検証結果:
- historical n=543, ROI=199.10%, roiExMax3Hits=162.15%
- PAPER_STRONG 判定（analyze-roi-decision-lab.ts セクション11参照）

この条件が forward 期間でも成立するかを paper 追跡する。
**本番 BUY/NO_BUY 判定には影響しない。**

### 実行コマンド

```bash
pnpm paper:forward
# → reports/roi-paper-forward.md / .json を更新
```

- `paper_roi_candidates` テーブルに INSERT OR IGNORE で記録（再実行安全）
- 2回目以降は `inserted=0` になる（stale rows が増えない）
- バックアップが必要な DB 変更は `paper_roi_candidates` のみ

### 再実行タイミング

**月4・月6・月8・月12に再実行する**（条件が該当月限定のため）。

```bash
# 月4/6/8/12 の初旬に実行
pnpm paper:forward
```

### 見るべきレポート

```
reports/roi-paper-forward.md   # 人間向けサマリー
reports/roi-paper-forward.json # 機械向け集計データ
```

主要指標:
- `rerunSafety.staleRows` → 0 であること
- `rerunSafety.totalRows` → 実行ごとに増えていくこと（新月分）
- `totals.forward` → forward 期間の累積件数
- `forwardMetrics.roi` → forward ROI（historical 約 199% に近づくか）
- `forwardMetrics.roiExMax3Hits` → 上位3件除外 ROI（≥100% が目標）

### 本番反映の判断基準

以下が全て揃うまで本番反映しない:

```
forward n >= 100
roiExMaxHit >= 100%
月8 以外に 4/6/12 のどれかが入っている
```

現在の状態（2026-06-08 時点）:
- forward n=25（月8のみ）
- 判定: ⚠️ PAPER（要観察・n不足）

### UNIQUE KEY について

現在: `UNIQUE(condition_name, race_id)`

将来、複数 selection を同一 race_id で追跡する場合は
`UNIQUE(condition_name, race_id, selection)` に変更が必要。
（ALTER TABLE は現時点では実施しない）

### 旧データクリーンアップ手順（参考）

旧スクリプトで誤登録したデータがある場合:

```bash
# 1. バックアップ
pnpm backup

# 2. 削除（対象 condition_name のみ）
node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/boat.sqlite');
db.prepare(\"DELETE FROM paper_roi_candidates WHERE condition_name = 'seasonal_parts0_month_4_6_8_12'\").run();
db.close();
"

# 3. 再生成
pnpm paper:forward
```

---

## 分析スクリプト一覧

| コマンド | スクリプト | 説明 |
|---|---|---|
| `pnpm analyze:roi-decision-lab` | scripts/analyze-roi-decision-lab.ts | ROI全条件ラボ（S/A/B判定・Paper候補精選） |
| `pnpm paper:forward` | scripts/paper-forward-test.ts | Paper forward test 記録・レポート更新 |
| `pnpm backup` | scripts/backup-db-safe.ts | DB バックアップ |
| `pnpm daily` | scripts/run-daily.ts | 日次処理 |
| `pnpm notify:line:daily` | scripts/notify-line.ts | LINE日次サマリ + BUY個別通知 |
| `pnpm notify:line:test` | scripts/notify-line.ts | LINE疎通テスト |
| `pnpm catchup` | scripts/run-catchup.ts | 過去分取り込み |
