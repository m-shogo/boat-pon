# boat-pon AI作業引継ぎ（正本）

更新: 2026-07-23 16:24 JST

この文書は、過去チャットを読めない別のAIチャットが現在地を誤解せず再開するための入口である。数値は更新時点のスナップショットなので、作業開始時に下記コマンドで再計測する。

## 最初に読むもの

1. `CLAUDE.md` — 絶対禁止事項。禁止事項は常に最優先。
2. `docs/current-ai-handoff.md` — 現在地と次の作業。
3. `reports/current-system-correctness-audit.md` — 正誤・未完了一覧。
4. `docs/prediction-improvement-roadmap.md` — 収益性改善のgate。
5. `reports/t5-collector-efficiency.md` — T-5収集率と重複率。
6. `docs/odds-timeseries-compaction-runbook.md` — DB圧縮の人間向け手順。
7. `docs/market-residual-ticket-selection-roadmap.md` — 現在フェーズ終了後の市場残差・全券種選択計画。

`CLAUDE.md`内の2025-06フェーズ説明には古い数値がある。禁止事項は有効だが、現在状況はこの文書と上記監査レポートを正本にする。

## 結論

- 現行システムは完璧ではない。
- 収集・通知経路の重大な欠陥は修正したが、予測確率と収益性は不合格。
- BUYはpaper観察候補であって購入指示ではない。BUY増加を予測改善と解釈しない。
- 修正前T-5標本は、前checkpointの5分キャッシュを再利用した可能性を完全には除外できない。
- 正式な収益評価は、2026-07-21 15:15 JST以降に公式networkから直接取得したfuture-only T-5だけでやり直す。
- DB肥大化の新規増加は抑制済みだが、13.98GiBの原本圧縮は未実施。

## 絶対にしてはいけないこと

- DBへの`INSERT / UPDATE / DELETE / DROP`
- `app_settings`変更
- 本番decisionロジック・モデル閾値・BudgetRule変更
- 自動投票、投票サイト操作、ログイン情報保存
- `data/`や`backups/`の削除
- BUYを「買えば利益になる」と説明すること
- current oddsだけを実収益として評価すること
- 修正前317件を正式なnetwork-only T-5標本として扱うこと

DB compact候補を作るスクリプトは存在するが、エージェントは実行しない。原本切替・DELETE・VACUUMは人間の保守作業である。

## 2026-07-21に確定した問題と修正

### 収集母集団

旧実装はモデル候補から収集raceを作り、候補が無い公式番組を落とし得た。現在は`official_programs`の当日全raceを直接母集団にする。

### T-5取り逃し

- JST 08:00〜21:05に収集
- 締切が近いraceから処理
- 収集は締切1分前まで継続
- BUY通知は実残り5分以上を別gateとして維持
- 同一race/checkpointの完全市場は再取得・再保存しない
- 欠場は「有効オッズ＋欠場セル＝120」で構造的完全とする

### 保存時刻の誤り

通信開始前に決めた残り分数/checkpointを保存していた。現在は公式応答後の実時刻で再計算し、締切後に届いた応答は保存しない。

### checkpointキャッシュ汚染

T-10等で保存した5分キャッシュをT-5として再利用し得た。未完成checkpointは必ず公式networkから再取得し、実行ログへ`source=network`を出す。

### 遅延

公式通信を締切順・上限2件で並列化した。本番確認値:

- 判断開始遅延: 62.993秒 → 37.574秒（40.35%減）
- 全体: 85.020秒 → 57.917秒（31.88%減）
- 15:17 JST実行: 7件すべてnetwork、失敗0、終了コード0

ただし、後段decisionはジョブ開始時の`now`をまだ使う。約37秒の時刻差が残るが、本番decision変更禁止のため未変更。

### 通知とURL

- BUY通知はT-5ラベルだけでなく送信直前・各送信ループで実残り5分以上を確認する。
- 公式オッズURLは日付・場コード・race番号付きのBOAT RACE公式URL。
- 投票入口は公式案内にある`https://bu.tbbr.jp/`。自動投票はしない。

## 現在の実測

ユーザー報告時点（2026-07-23 13:12 JST）:

- 当日paper-live: BUY 3 / WATCH 8 / SKIP 49（13:11 JST、BUYは購入指示ではない）
- network-only正式cohort: T-5完全231/275、84.00%
- 当日途中: T-5完全49/59、83.05%
- 完了日の日次80% gate: 1/3日
- 新規保存重複率: 7月22日1.00x、7月23日途中1.00x
- 7月23日の収集エラー: 早朝3件。直近ログの各実行は`failed=0`、launchd終了コード0
- 全テスト: 373 pass / 0 fail
- 型検査・本番build・`git diff --check`: PASS

今回再実行時点:

- 当日paper-live: BUY 5 / WATCH 13 / SKIP 87（16:24 JST、開催進行による自然増加）
- collector監査: network-only T-5完全278/322、86.34%（16:22 JST）
- forward監査: network-only T-5完全281/325、86.46%（16:30 JST、収集ジョブ並行稼働中のため自然増加）
- formal settled: 52/1,000で不変。市場ROI64.23%、最大1的中除外40.98%、最大2的中除外29.60%
- 同一50レース: T-5市場ROI66.80%・logloss 3.7344、2023–2024履歴ROI75.20%・logloss 4.2723
- 事前校正の混合係数はα=0。全gate BLOCKED
- paper-live BUY結果確定は5件、的中0、100円×5件の仮想損益は-500円
- 7月23日早朝の一時取得失敗は鳴門1R・唐津1R・芦屋2Rの3件。各2回再試行後も失敗し、当該レースのcheckpointは未保存なので欠測として残る。その後の直近実行は`failed=0`
- launchd `com.boatpon.auto-odds`は終了コード0。7月22日・23日の保存重複率は1.00x

13:12から16:24の差は、当日レースの締切進行と収集ジョブの継続による自然増加である。formal settledは増えておらず、結果再取得、重複race、集計定義変更による増加は確認されていない。

収益性:

- 現行BUY: 推定的中率4.01% / 実績1.97% / 実払戻ROI69.32%
- 純T-5市場forward: n=114 / ROI60.53% / 最大2的中除外44.38%
- 残差モデル: train ROI145.67% / forward ROI72.81%、logloss/Brierも悪化
- network-only正式cohort: 結果確定52/1,000。市場ROI64.23% / 最大2的中除外29.60% / logloss 3.7434 / Brier 0.9516
- 2023-2024固定履歴モデル比較: 番組・展示まで揃う同一50レースで履歴ROI75.20%だが、市場ROI66.80%を含め両方赤字。事前校正で選ばれた混合係数はα=0で、履歴特徴の追加効果なし
- 正式gate: network-only T-5 settled 1,000件が必要

結論は次の意味に固定する。2023–2024履歴データは、比較、診断、候補モデル構築には利用できる。しかし現在のforward条件では、T-5市場確率へ追加する増分予測価値は確認できない。事前校正ではα=0が選択されており、現時点では履歴モデルを市場確率へ混ぜない方が良い。50レースは小標本で、両ROIは100%未満、履歴loglossは市場より悪く、市場ROIも少数の高配当に依存して最大2的中除外で29.60%まで低下する。formal settled 52/1,000では正式判断に不足する。

上記ROIは現行が不合格だという参考根拠にはなるが、修正前T-5にはキャッシュ鮮度の未証明がある。新モデルの合否判定にはnetwork-only future cohortだけを使う。

## DB肥大化

- DB全体: 13.98GiB
- 時系列: 48,896,342行
- race/checkpoint/selection一意: 1,147,183
- 重複相当: 47,749,159行
- 旧重複率: 最大52.02x
- 修正後: 約1.07x
- compact計画: 48,875,702行 → 1,133,023行（2.32%保持）
- 完全市場保持: 9,342/9,342 PASS
- 推定: 13.98GiB → 6.04GiB、約7.94GiB回収

圧縮計画と検証器はあるが、候補DB作成・fingerprint検証・atomic切替は未実施。原本DBを直接変更しない。

## 作業開始時の確認コマンド

すべてリポジトリ直下`/Users/m-shogo/Developer/personal/boat-pon`で実行する。

```bash
pnpm handoff:ai
git status --short
pnpm exec tsx scripts/auto-fetch-odds.ts --dry-run
pnpm audit:t5-collector-efficiency
tail -n 40 data/logs/auto-odds.log
launchctl print gui/$(id -u)/com.boatpon.auto-odds
```

DB確認が必要なら読み取り専用/immutableで行う。

```bash
sqlite3 'file:data/boat.sqlite?immutable=1' \
  "SELECT decision,COUNT(*) FROM decision_history WHERE date=date('now','+9 hours') AND run_kind='paper-live' GROUP BY decision;"
```

検証:

```bash
pnpm test
pnpm typecheck
git diff --check
```

## 次に進める順序

1. `network-only正式cohort`のT-5完全率、確定結果数、実払戻ROIを日次で更新する。
2. 完成日の日次coverage 80% gateを確認する。修正前を含む累積率だけで合格にしない。
3. network-only settledが貯まったら、市場のみ・現行モデル・残差モデルを同一race母集団で比較する。
4. forward ROI、最大2的中除外ROI、CLV、logloss、Brier、最大ドローダウンを全て出す。
5. 2連単・2連複は券種付きT-5完全市場と実払戻結合が完成してからfuture-onlyで比較する。
6. 本番判定変更が必要なら、先に人間がリポジトリ規則の変更範囲を明示する。
7. DB圧縮は人間の明示承認後、runbook通り別候補DBで実施する。

2023-2024固定履歴モデルと市場の比較器は実装済み。現時点ではα=0が選ばれたため、特徴量追加や本番接続へ進めず、同じ固定条件のformal future蓄積を続ける。

市場残差・全券種選択の次フェーズ構想は`docs/market-residual-ticket-selection-roadmap.md`を正本とする。ただし、次に行うのは現在のformal settled蓄積と本フェーズの完了であり、モデル実装へ直ちに移行しない。別タスクのPhase N0で取得可能性・保存設計を監査し、最低1,000 settled gate到達前に残差モデル学習を始めない。

## やっても改善にならないこと

- BUY件数だけ増やす
- 過去データへ特徴量を大量追加し、同じholdoutを繰り返し見る
- current odds ROIで黒字に見せる
- T-5/T-10/closing oddsを混ぜる
- 複数`captured_at`のunionで完全市場を作る
- 高配当1〜2件依存を無視する
- 修正前T-5とnetwork-only T-5を同じ正式母集団にする

## 主な実装・資料

- `scripts/auto-fetch-odds.ts` — 公式番組母集団、時刻再計算、network-only、並列収集、通知
- `src/domain/liveOddsFetch.ts` — 締切順、完全checkpoint、並列上限制御
- `src/domain/buyNotification.ts` — T-5＋実残り時間の通知gate
- `src/domain/buyResultNotification.ts` — paper BUYの的中/外れ、公式払戻、100円仮想損益を結果確定後に通知
- `scripts/analyze-historical-ranking-forward.ts` — 2023-2024固定学習、2025/2026 forwardと重み成果物
- `scripts/audit-t5-historical-market-forward.ts` — 固定履歴モデル・T-5市場・事前固定混合を同一formal raceで比較
- `scripts/audit-t5-collector-efficiency.ts` — 修正後/network-only cohort監査
- `scripts/audit-t5-market-baseline.ts` — 市場baseline
- `scripts/analyze-t5-residual-forward.ts` — 残差forward検証
- `scripts/audit-odds-timeseries-storage.ts` — DB肥大化監査
- `scripts/plan-odds-timeseries-compaction.ts` — compact計画
- `scripts/verify-odds-timeseries-compaction.ts` — 原本/候補fingerprint比較
- `scripts/build-compact-odds-candidate.ts` — 人間専用の候補DB作成器。エージェント実行禁止

## 作業ツリー上の注意

本タスクの差分はcommit・pushしてcleanにする。次回開始時は`git status --short`と`git rev-parse HEAD origin/main`を再確認する。その後に新しい未追跡・変更済みファイルがあればユーザー所有として扱い、広範なrevert・reset・checkoutをしない。

`pnpm handoff:ai`のguard結果と実運転状態は分けて確認する。収集ジョブはlaunchdの終了コードと`data/logs/auto-odds.log`を正本にする。
