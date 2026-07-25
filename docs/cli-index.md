# boat-pon CLI Index

boat-pon の CLI が増えてきたため、用途別に整理した索引です。

重要:

- `fetch:*` / `backfill:*` は外部取得を伴う可能性があります。
- `report:*` / `check:*` / `audit:*` は基本的に read-only です。
- 自動投票・ログイン保存・投票サイト操作は入れません。
- N0後の最上位計画は[`research-platform-master-plan.md`](research-platform-master-plan.md)、研究・破綻防止契約台帳は[`research-idea-register.json`](research-idea-register.json)を参照してください。Stage F0/F0-Rは完了し、N1-A offline foundationは完了、N1-B Permanent Settlement Schema Rolloutは`CONDITIONAL`（`n1-settlement.0.1`を永続sidecarへzero-data適用済み、N1-C backfillはquota/evidence pin/別承認待ち）です。N1-C準備（Option B writer・`n1-settlement.0.2` checkpoint schema・backfill executor）は実装＋temp/restore検証済みで、永続sidecarへの0.2適用と実backfillは未実行です。

## Research Replay Foundation

すべてsanitized fixtureとtemp DBだけを使用し、外部HTTPや`data/boat.sqlite`書込みを行いません。

| command | 目的 |
|---|---|
| `pnpm research:replay:canary` | 五層lineageのE2E canary |
| `pnpm research:replay:canary -- --write-reports` | canaryを実行してF0 reportを更新 |
| `pnpm research:manifest:dry-run` | as-of manifestの採用・拒否・完全性を表示 |
| `pnpm research:raw-cache:audit` | dedup、orphan、integrity、pin、容量を監査 |
| `pnpm research:schema:verify` | sidecar version、migration checksum、reader/writer contractを検証 |
| `pnpm research:golden:verify` | raw/semantic/manifest golden hashを検証 |

| `pnpm research:rollout:dry-run -- --root=/tmp/boat-pon-f0r` | temp sidecarでF0-R readinessを検証 |
| `pnpm research:rollout:readiness` | 実sidecarのOFF設定、backup/restore、readiness reportを再検証 |

`research:rollout:readiness`はsidecar・backup・reportへ追記するためread-onlyではありません。外部HTTP、live collector接続、`data/boat.sqlite`書込みは行いません。現行formal CLIの出力へ新方式の成績を混ぜません。

## 毎日/定期運用

| command | 目的 | 注意 |
|---|---|---|
| `pnpm catchup` | 取りこぼし補完 | 外部取得あり |
| `pnpm daily` | 日次処理 | 外部取得あり |
| `pnpm health` | 全体ヘルス確認 | 基本read-only |
| `pnpm backup:safe` | 安全バックアップ | 推奨 |
| `pnpm backup` | 安全バックアップ | `backup-db-safe.ts` を使用 |

## 100点化チェック

| command | 目的 |
|---|---|
| `pnpm check:100` | 100点化に必要な残項目を確認 |
| `pnpm check:100 -- --strict` | 未達なら非0終了 |
| `pnpm audit:persistence` | audit保存の接続状態を確認 |
| `pnpm audit:persistence -- --strict` | audit保存が未達なら非0終了 |
| `pnpm patch:paper-wording -- --dry-run` | paper通知文言の安全化差分を確認 |
| `pnpm patch:paper-wording -- --write` | paper通知文言を安全側に置換 |

## 一括レビュー

| command | 目的 |
|---|---|
| `pnpm review:suite -- --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD` | 主要reviewを一括実行 |
| `pnpm review:suite -- --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD --keep-going` | 途中失敗しても続行 |
| `pnpm review:log -- --date YYYY-MM-DD --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD` | 日付付きレビュー記録を作成 |

推奨例:

```bash
pnpm review:log -- --date 2026-06-04 --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
pnpm review:suite -- --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
```

## レビュー・分析CLI

### 最初に見る

| command | 目的 |
|---|---|
| `pnpm report:review-summary -- --from YYYY-MM-DD --to YYYY-MM-DD` | 全体サマリー |
| `pnpm report:rule-candidates -- --from YYYY-MM-DD --to YYYY-MM-DD --min-settled 50` | ルール見直し候補 |
| `pnpm report:decision-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD` | BUY/WATCH/SKIP結果比較 |

### 外れ・見送り確認

| command | 目的 |
|---|---|
| `pnpm report:buy-misses -- --from YYYY-MM-DD --to YYYY-MM-DD` | BUYしたが外れたもの |
| `pnpm report:missed-hits -- --from YYYY-MM-DD --to YYYY-MM-DD` | WATCH/SKIPで当たっていたもの |
| `pnpm report:decision-reasons -- --from YYYY-MM-DD --to YYYY-MM-DD` | decision reasonの集計 |

### オッズ・市場

| command | 目的 |
|---|---|
| `pnpm report:clv -- --from YYYY-MM-DD --to YYYY-MM-DD` | CLV確認 |
| `pnpm report:odds-band-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | オッズ帯別のBUY成績 |
| `pnpm report:market-warnings -- --from YYYY-MM-DD --to YYYY-MM-DD` | 市場が嫌ったBUY / 買ったWATCHを確認 |
| `pnpm report:popularity-movement -- --from YYYY-MM-DD --to YYYY-MM-DD` | 人気順位推移 |

### データ品質・特徴量

| command | 目的 |
|---|---|
| `pnpm report:data-quality-outcomes -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | データ品質別のBUY成績 |
| `pnpm report:feature-breakdown -- --from YYYY-MM-DD --to YYYY-MM-DD` | feature adjustment確認 |
| `pnpm report:data-coverage` | データカバレッジ |
| `pnpm stats:racer-coverage` | 選手成績カバレッジ |

### 確率・安定性

| command | 目的 |
|---|---|
| `pnpm report:calibration -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 推定的中率の校正 |
| `pnpm report:payout-sensitivity -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 上位配当依存確認 |
| `pnpm report:time-split-stability -- --from YYYY-MM-DD --split-date YYYY-MM-DD --to YYYY-MM-DD --decision BUY --min-settled 50` | 前半/後半の安定性 |
| `pnpm report:model-version-simple -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | model_version比較 |
| `pnpm analyze:ability-market-validation` | 能力情報×市場順位をdiscovery/validation/testで検証 |
| `pnpm analyze:roi-improvement-validation` | ROI改善候補を実払戻し・時系列分割・高配当依存で再検証 |
| `pnpm report:roi-all-data-sweep` | 選手・モーター・開催・市場など全データ探索結果を集約 |
| `pnpm analyze:wind-direction-venue` | 会場×風向×4号艇相対能力を実払戻しで再分解 |
| `pnpm dry-run:exacta -- --date YYYY-MM-DD --venue 住之江 --race 6` | 公式2連単を1レースだけ取得し、券種付き時系列rowを生成（DB/キャッシュ書き込みなし） |
| `pnpm audit:root-methodology` | 母集団・払戻結合・時点整合性・確率較正の根本監査（読み取り専用） |
| `pnpm audit:exacta-forward-pipeline` | 2連単future-only収集・保存・監視経路を読み取り専用監査 |
| `pnpm analyze:canonical-calibration` | 現行BUYを同一母集団・実払戻でtrain/forward較正 |
| `pnpm analyze:calibration-stability` | 月別・最大払戻除外・会場LOOで較正の安定性を監査 |
| `pnpm audit:t5-market-baseline` | モデル非依存のT-5全120通り市場ベースラインを監査 |
| `pnpm analyze:t5-residual-forward` | 6月train→7月以降forwardで市場残差モデルを評価 |
| `pnpm audit:t5-collector-efficiency` | T-10取得済み/T-5欠測・日次coverage・重複保存率を監査 |
| `pnpm audit:t5-network-only-forward` | network-only T-5正式cohortを同一race・実払戻・logloss/Brierでfuture評価 |
| `pnpm research:approval:record -- --event=...` | F0-R承認grant/revoke/supersedeを必須field明示でappend（readinessとは分離） |
| `pnpm verify:n1-payout-review` | N1払戻レビューの7券種・20 fixture・状態機械・禁止scope・文書リンクを検証 |
| `pnpm research:n1:rollout:capacity -- --write-reports` | N1-B: 実archive stratified sampleで容量・性能・evidence pin冗長を実測しfull backfill projectionを生成 |
| `pnpm research:n1:rollout:readiness` | N1-B: N1-B明示承認・primary read-only・pre-migration gateを確認（apply=false、承認なしはBLOCKED） |
| `pnpm research:n1:rollout:apply -- --write-reports` | N1-B: 承認済み時のみ`n1-settlement.0.1`を永続sidecarへzero-data適用（backup→migration→post-gate→restore-copy canary） |
| `pnpm research:n1:rollout:capacity -- --write-reports` | N1-C準備: explicit/implicit(Option B)を同一sampleで比較し、evidence pin廃止時のDB削減(-48.6%)とprojectionを出力 |
| `pnpm research:n1:rollout:backfill-sample -- --max-files=3` | N1-C準備: 使い捨てtemp sidecarで実archive sample backfillを検証（Option B pin=0・冪等resume、永続sidecar/primary非接続） |
| `pnpm audit:t5-historical-market-forward` | 2023-2024固定履歴モデルとT-5市場を同一raceのformal futureで比較 |
| `pnpm analyze:historical-ranking-forward` | 2023-2024番組・展示だけで学習し2025/2026を着順確率・実払戻で固定forward評価 |
| `pnpm audit:odds-timeseries-storage` | 時系列DBの日別重複率・物理肥大化を読み取り専用監査 |
| `pnpm audit:all-bet-type-feasibility` | Phase N0の全7券種source・DB/schema・coverage・request budgetを読み取り専用再監査 |
| `pnpm plan:odds-timeseries-compaction` | 完全市場を保持する時系列compact計画と削減見込みを読み取り専用生成 |
| `pnpm verify:odds-timeseries-compaction` | compact候補DBをintegrity・保持rows・fingerprintで原本と読み取り専用比較 |
| `pnpm build:odds-timeseries-compact-candidate` | 人間保守専用。原本を変更せず別候補DBをbackup・compact（確認文字列とauto-odds unload必須） |

### 会場/月別

| command | 目的 |
|---|---|
| `pnpm report:venue-monthly -- --from YYYY-MM-DD --to YYYY-MM-DD --decision BUY` | 会場・月別確認 |
| `pnpm report:quality -- --days 30` | 直近品質確認 |
| `pnpm report:weekly` | 週次品質 |
| `pnpm report:monthly` | 月次品質 |

## 取得・補完CLI

外部取得を伴うため、必要な時だけ実行します。

| command | 目的 |
|---|---|
| `pnpm fetch:official-results` | 公式結果取得 |
| `pnpm fetch:official-programs` | 公式番組取得 |
| `pnpm fetch:pending` | pending取得 |
| `pnpm backfill:odds` | オッズ補完 |
| `pnpm backfill:beforeinfo` | 直前情報補完 |
| `pnpm backfill:beforeinfo:dry` | beforeinfo補完dry-run |
| `pnpm fetch:racer-stats` | 選手成績取得 |
| `pnpm fetch:racer-stats:dry` | 選手成績dry-run |

## DB・監査・検証

| command | 目的 |
|---|---|
| `pnpm db:init` | DB初期化 |
| `pnpm db:health` | DBヘルス確認 |
| `pnpm validate:data` | データ検証 |
| `pnpm migrate:decision-audit` | decision auditカラムmigration |
| `pnpm audit:doctor` | audit状態診断 |
| `pnpm audit:persistence` | audit fieldsのDB/コード接続確認 |
| `pnpm fill:decision-reasons` | decision reasons補完 |

## 開発・検証

| command | 目的 |
|---|---|
| `pnpm typecheck:scripts` | scripts型チェック |
| `pnpm test` | domain test |
| `pnpm typecheck` | 全体型チェック |
| `pnpm build` | build |
| `pnpm verify` | typecheck + test + build |

## 推奨レビュー順

```bash
pnpm check:100
pnpm audit:persistence
pnpm review:suite -- --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01 --keep-going
pnpm typecheck:scripts
pnpm test
pnpm audit:doctor
pnpm backup
```

## 今後の命名整理案

今後 scripts がさらに増えるなら、package scripts を以下のように寄せると見やすいです。

```text
review:*   検証・反省レポート
fetch:*    外部取得
backfill:* 補完
ops:*      backup / health / readiness
migrate:*  DB migration
```

ただし、既存コマンドを壊さないため、まずは alias 追加から行い、削除・改名はしない方針です。
