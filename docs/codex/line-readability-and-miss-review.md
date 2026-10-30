# Codex 指示書: LINE通知とレポートを読みやすくし、外れの検証を作る

このファイルは Codex CLI にそのまま渡すための依頼書です。
Mac のリポジトリ直下で次を実行してください。

```sh
codex "docs/codex/line-readability-and-miss-review.md を読んで、書かれた順に作業して"
```

---

## 0. 絶対に変えないもの（財布ルール）

次は**一切変更しない**。見た目を整えるだけで、数字や判定は今と同じにする。

- 推奨額（`recommendedStakeYen`）、資金配分、賭け金の計算
- BUY / SKIP の判定、候補、selection、閾値、model、selector
- LINE の送信条件・送信時刻・送信先・重複防止キー（`dedupeKey`）
- `app_settings`、DB（INSERT/UPDATE/DELETE/DROP 禁止）、`data/` と `backups/`
- 自動投票・ログイン保存・投票サイト操作

迷ったら変更しないで、変更案として報告だけする。

---

## 1. LINE 通知本文を読みやすくする

### 対象

- `src/domain/buyLineMessageContract.ts` の `buildBuyLineMessage()` の `body` と `title`
- 対応するテスト（`buyLineMessageContract` を参照している `*.test.ts`）

### 今の問題

- 16行が同じ形で並び、どこを見ればいいか分からない
- `race:` `sample:` `model:` など英語の内部ラベルが混ざっている
- 理由・警告が `/` 区切りで1行に詰め込まれている
- 一番大事な「締切」「推奨額」「オッズ」が埋もれている

### 目標の形（例）

```
🎯 BUY候補 桐生 5R
3連単 1-3-2

⏰ 締切 14:32（確認 14:21）
💴 推奨 100円
📈 オッズ 12.4倍（必要 9.8倍以上）
🎲 的中率 9.1%　EV 1.13

✅ 理由
・風速2〜4m
・1号艇展示1位

⚠️ 注意
・サンプル少なめ

🔗 公式オッズ
https://...

―――
検証用の候補です。自動投票はしません。
公式オッズと締切を確認して、自分で判断してください。
（race 202610300105 / n=412 / data 完全 / model v4 live）
```

### ルール

- **情報は1つも消さない**。順番と書き方だけ変える。内部向けの項目（raceId、sample、data、model）は最後の小さい1行にまとめる
- 理由・警告は1件1行の箇条書きにする。0件なら見出しごと出さない
- `data` 表示は `COMPLETE/PARTIAL/BLOCKED` → `完全/一部欠け/取得不可` にする
- `PARTIAL` か `BLOCKED` のときは、締切の行の直前に `⚠️ データが不完全です` を目立つように出す
- 数値の桁・丸め方は今と同じ（オッズ小数1桁、的中率 %小数1桁、EV 小数2桁、推奨額は整数の円）
- `LINE_TEXT_MAX_LENGTH` を超えないことをテストで確認する（理由・警告が多いケースも）
- `BUY_LINE_MESSAGE_SCHEMA_VERSION` は表示形式が変わるので `buy-line-message-v2` に上げる。上げると壊れる参照があれば一緒に直す
- 推奨額が変わっていないことを示すテストを1つ足す（入力の `recommendedStakeYen` がそのまま本文に出る）

---

## 2. 日次・週次レポートを読みやすくする

### 対象

- `scripts/run-review-suite.sh` が呼ぶレポート
  （`report:buy-misses`, `report:missed-hits` など）
- `report:daily`

### ルール

- 先頭に「今日（今週）の結論」を3行以内で書く。例:
  `BUY 12件 → 的中 1件（予想では 1.6件）。外れは想定の範囲内。`
- 表は列を減らし、日本語の見出しにする。細かい列は `--json` か `--detail` のときだけ出す
- 長い一覧は上位10件まで。残り件数を最後に1行で出す
- 計算ロジック・集計の数字は変えない。表示だけ変える
- 既存の `--json` 出力の形は変えない（他のスクリプトが読んでいる可能性がある）

---

## 3. 外れの検証（新規・読み取り専用）

「外れすぎ」が本当にモデルの想定より悪いのか、ただの運なのかを判断できるようにする。

### 新規スクリプト

`scripts/report-miss-review.ts`（`pnpm report:miss-review`）を作る。DB は読み取り専用で開く
（`readOnly: true` + `PRAGMA query_only = ON`、既存の `report-buy-misses.ts` と同じ開き方）。

### 出すもの

1. **想定との比較（いちばん大事）**
   - 期間内の確定 BUY 件数、実際の的中数、予想的中数（`estimatedHitRate` の合計）
   - 二項分布で「この的中数以下になる確率」を出す
   - 判定: 5%未満なら「想定より明らかに悪い」、それ以外は「想定の範囲内」
2. **的中率の当たり具合（キャリブレーション）**
   - `estimatedHitRate` を 0–5%, 5–10%, 10–20%, 20%以上 に分け、予想と実際を並べる
3. **外れ方の内訳**
   - 1着から違う / 1着は合っていて2着が違う / 2着まで合っていて3着が違う
   - 3着だけ違う外れが多いなら「惜しい外れ」が多いと分かる
4. **条件別の外れ**
   - 会場、オッズ帯、EV帯、レース番号ごとに件数・的中・予想的中を並べる
   - 件数30未満の行には「少数・参考」と付け、結論に使わない
5. **お金の見え方**（実払戻ベース。CLAUDE.md の基準どおり `race_payouts.payout_yen` を主に使う）
   - 投入額、払戻、ROI。current_odds ベースは参考値として横に出すだけ

### 出力

- 先頭3行に結論（例: `直近30日 BUY 48件 / 的中 3件（予想 4.7件）。確率 23% → 想定の範囲内。`）
- `--json` で同じ内容を機械可読に出す
- `--from` / `--to` で期間指定、デフォルトは直近30日

### やらないこと

- 結果を見て閾値・selector・model・推奨額を変えること（提案は文章で書くだけ）
- DB への書き込み

---

## 4. 確認してから終わる

すべて通ることを確認する。

```sh
npm run typecheck
npm test
node scripts/verify-product-boundaries.mjs
node scripts/verify-buy-line-learning-boundaries.mjs
npm run build
pnpm report:miss-review -- --from 2026-10-01 --to 2026-10-30
```

最後に、次をまとめて報告する。

- LINE 本文の変更前 / 変更後（同じ入力で1件ずつ）
- `report:miss-review` の結論3行
- 推奨額・判定・送信条件が変わっていないことの確認方法
- 変更したファイル一覧

作業はブランチ `codex/line-readability-miss-review` で行い、main へ直接 commit しない。
