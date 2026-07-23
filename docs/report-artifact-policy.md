# reports 生成物の管理ポリシー（生成日時差分対策）

作成: 2026-06-13（データ基盤監査パックの成果物）
今回は **.gitignore 変更・既存運用の大規模変更は行わない**。問題の整理と対策案のみ。

## 1. 問題

- reports/ 配下の生成物 130 ファイルが git 管理されており、うち **65 個の JSON が
  `generatedAt`（md は `生成日時:` 行）を含む**
- データが変わっていなくてもレポートを再生成すると generatedAt の 1〜2 行だけが差分になり、
  作業ツリーが常に dirty になる（例: 本日時点の `reports/paper-forward-monitor.{md,json}`
  は generatedAt 行のみの差分）
- 「データ更新による意味のある差分」と「ただの再生成」が git status 上で区別できない

## 2. 毎回 dirty になりやすいレポート

候補監視 3点セット + exacta monitor は運用上頻繁に再生成されるため、特に汚れやすい:

| レポート | 生成コマンド | dirty要因 |
|---|---|---|
| reports/paper-forward-candidates.{md,json} | `pnpm report:paper-forward-candidates` | generatedAt |
| reports/paper-forward-monitor.{md,json} | `pnpm report:paper-forward-monitor` | generatedAt |
| reports/wind24-exh1-switch-deep-dive.{md,json} | `pnpm analyze:wind24-exh1-switch` | generatedAt |
| reports/roi-improvement-validation.{md,json} | `pnpm analyze:roi-improvement-validation` | generatedAt |
| reports/roi-all-data-sweep.{md,json} | `pnpm report:roi-all-data-sweep` | generatedAt |
| reports/wind-direction-venue-screen.{md,json} | `pnpm analyze:wind-direction-venue` | generatedAt |
| reports/exacta-forward-monitor.{md,json} | `pnpm report:exacta-forward-monitor` | generatedAt |
| reports/racer-data-freshness.{md,json} | `pnpm report:racer-freshness` | generatedAt + 鮮度日数が日付依存 |
| reports/racer-ability-data-audit.{md,json} | `pnpm report:racer-ability-audit` | generatedAt（本監査も同型） |

それ以外の analyze:* 系も同じ構造だが、再生成頻度が低いため実害は小さい。

## 3. 対策案（推奨順）

### 案A: 「内容ハッシュで変化がなければ書き込まない」(推奨・小修正)

各レポートスクリプトの書き込み直前に「generatedAt を除いた内容」を既存ファイルと比較し、
同一なら書き込みをスキップする共通ヘルパー（例: `scripts/lib/write-report.ts`）を導入する。

- 利点: git 履歴が「意味のある変化」だけになる。運用変更なし。diff レビューが楽になる
- 欠点: 「いつ最後に確認したか」がファイルから消える（→ JSON に `dataFingerprint` を持たせ、
  generatedAt は変化があった時だけ更新、で両立できる）

### 案B: generatedAt を決定的な値にする

generatedAt を「現在時刻」ではなく「入力データの最大日付（例: DB内 max(date)）」にする。
データが同じなら出力もバイト同一になる。

- 利点: 実装が最小（各スクリプト1行）
- 欠点: 実行時刻の記録が消える

### 案C: 生成物を git 管理から外す（今回はやらない）

reports/ を .gitignore し、コミットしたいスナップショットだけ `reports/archive/` 等に
明示的にコピーする運用。

- 利点: 根本解決
- 欠点: 「過去レポートが git 履歴で追える」という現在の利点を失う。
  CLAUDE.md・既存ワークフローが reports/ のコミットを前提にしているため影響が大きい

## 4. 当面の運用ルール（現状維持のまま明文化）

1. **generatedAt（生成日時行）だけの差分はコミットしない**。`git checkout -- <file>` で戻すか、
   意味のある変更と一緒になるまで放置してよい
2. データ更新を伴う再生成では、generatedAt 以外の差分（n、ROI、coverage など）を確認してから
   レポートをコミットする
3. コミットメッセージにはレポート名ではなく「何が変わったか」を書く（既存慣行どおり）
4. 新規レポートスクリプトを書くときは、可能なら案A/案B のいずれかを最初から組み込む

## 5. 提案（安全な小修正・未実施）

- 共通ヘルパー `writeReportIfChanged(path, content, { ignorePattern: /generatedAt|生成日時/ })`
  を作り、まず候補監視 3点セット + exacta monitor + racer-ability-audit の 5 スクリプトだけに
  適用する（他は触らない）
- 実施する場合は別コミットとし、レポート内容のバイト差分が出ないことを
  `git diff --stat` で確認してからマージする
