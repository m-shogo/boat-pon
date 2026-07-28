# Phase N1-B Permanent Settlement Schema Rollout & Capacity Gate

更新: 2026-07-25
状態: **CONDITIONAL / SCHEMA APPLIED (zero-data) / N1-C GATED**

## 結論

N1-Aで凍結した `n1-settlement.0.1`（migration checksum `35903ee175dbb31cbc7202aa573a2e1b4f6d58d9b6954cfac4cee0fdfa4eb94d`）を、永続 Research Replay sidecar `data/research-replay.sqlite` へ **zero-data** で適用した。7つのN1 tableと14個のappend-only triggerを空のまま追加し、F0/F0-R schemaは変更していない。`data/boat.sqlite` は read-only fingerprint監査だけに使い、schema・`app_settings`・Legacy collector・ROI・予測へは接続していない。

historical full backfill（8,164 archive）・future result collector・shadow writer・operational GC・Phase N2・model・productionには着手していない。実archive stratified sampleで容量を実測した結果、full backfillは現1GiB quotaに収まらず、evidence pinに重複コストがあるため、**N1-Cはquota引き上げとevidence pin方式変更を条件にCONDITIONAL**とする。

実測正本:

- [`../reports/n1-settlement-capacity-benchmark.md`](../reports/n1-settlement-capacity-benchmark.md) / [`.json`](../reports/n1-settlement-capacity-benchmark.json)
- [`../reports/n1-settlement-permanent-rollout-readiness.md`](../reports/n1-settlement-permanent-rollout-readiness.md) / [`.json`](../reports/n1-settlement-permanent-rollout-readiness.json)
- backfill契約: [`n1-settlement-backfill-design.md`](n1-settlement-backfill-design.md)

## 明示承認gate

- scope: `N1_PERMANENT_SETTLEMENT_SCHEMA_ROLLOUT`
- approval id: `n1b-permanent-settlement-schema-rollout-20260725`（append-only、production grant）
- target: stage `N1-B` / schema `n1-settlement.0.1` / contract `n1-settlement-rollout-v1`
- resolver: `f0r-approval-resolver-v1`、resolution `APPROVAL_VALID`
- 既存 `f0r-hardening-explicit-20260724`（F0-R scope）は再利用していない。scope不一致は `APPROVAL_SCOPE_MISMATCH` で拒否されることを実測した。
- readiness / migration自身は承認rowを生成しない。承認は `research:approval:record` の別イベントで先に記録した。
- revocation / supersession契約は維持。今回はrevoke/supersedeを発行していない。

明示承認が存在しない場合の挙動は `N1-B RESULT: BLOCKED / HUMAN_APPROVAL_MISSING`（テスト `n1Rollout.test.ts` で固定）。

## Primary DB read-only証明

`data/boat.sqlite` に対しN1プロセスは:

- `readOnly: true` 接続 + `PRAGMA query_only = ON` を強制
- write connection count = 0 / write SQL count = 0（DML/DDLを一切発行しない）
- migration targetはpath/realpathで sidecar のみと検証し、primaryとの同一fileを拒否
- attached database = なし
- 適用前後で primary schema hash・`app_settings` hash が不変であることを確認

15GBのprimaryは並行collectorでmtime/size/data hashが自然更新され得るが、それをN1失敗としない。N1由来の変更が無いこと（schema/app_settings hash不変、write SQL=0、target=sidecar only）を証明する方式を採用した。

## Capacity benchmark（migration前・実archive sample）

永続sidecarへfull backfillはせず、使い捨てtemp DBに実archiveのstratified sampleだけを実投入して測定した。sample選択は決定的（seed `n1b-capacity-stratified-v1`、RNGなし）。

- sample: 75 day-files / 11,621 races / 24会場 / 2000s・2010s・2020s / legacy 7・modern 68
- special: 返還candidate 2,873 / 複数line payout 21,398（partial返還・特払いはsampleに現れず、synthetic 20-case canaryで担保）
- 実測: candidate 74,673 / payout line 104,404 / refund line 4,397 / evidence pin 224,019 / DB 101,982,208 bytes
- 単位: bytes/race ≈ 8,776 / bytes/candidate ≈ 1,366 / bytes/payout ≈ 977 / bytes/evidence pin ≈ 455
- index overhead ≈ 0.303 / **evidence pin share ≈ 0.331** / WAL amplification ≈ 0.041 / backup amplification ≈ 0.974
- timings(ms): migration 3.1 / insert 11,520 / replay 13.9 / backup 212.8 / restore 206.8

### Full backfill projection（低/基準/高）

| projection | low | base | high |
|---|---:|---:|---:|
| full DB bytes | 8.91 GB | **10.48 GB** | 13.10 GB |
| raw store bytes | 1.22 GB | 1.44 GB | 1.80 GB |
| backup bytes | 8.68 GB | 10.21 GB | 12.76 GB |

- 全candidate ≈ 7.67M / payout line ≈ 10.73M / **evidence pin ≈ 23.02M**
- temp free-space要件 ≈ 22.39 GB / disk free 実測 ≈ 421 GB

### Quota判定

- current quota **1 GiB** に対し、full backfill projected（DB+raw、highバンド）は **収まらない (fits=false)**
- 推奨 quota ≈ **17.1 GB** / 推奨 low-water ≈ 34.3 GB / 推奨 backup retention 3
- 幅はlow/base/highで提示し、fixtureではなく実archive sampleを根拠にした。

## Evidence pin構造の判定

現 `n1-settlement.0.1` は candidate毎に `settlement_evidence_pins_v2` へ raw_document / parse_run / domain_observation の3行を保存する（3行は同一 evidence_hash）。sample実測で **DBの約33%** を占め、full backfillで **約23M行** に達する。candidateは既に同3参照を `ON DELETE RESTRICT` FKで保持しているため、この3行は冗長である。

判定: **Option B（candidate FKを暗黙GC pinとして解釈し、per-candidate explicit pinを廃止）を採用する。**

- N1-Bでは schema `n1-settlement.0.1` を破壊せずzero-dataで適用済み（永続store側pin=0のため今回のコストは0）。
- explicit pin table自体は将来のcohort/evaluation pin用に残す余地があるため、N1-Cで writer挙動（appendCandidateのpin書込み）を止める形の変更＋version bump（`n1-settlement.0.2`）とする。temp migration PASS・old N1-A fixture PASS・checksum更新・理由文書化・golden/F0 hash不変を満たしてから適用する。
- 比較検討: A（explicit pin per evidence）はGC安全だが23M重複行。B（direct FK implicit pin）はGC安全性をFK RESTRICTで担保しstorageを削減。C（materialized reference graph）はquery容易だが二重管理。**Bを採用**。

## Backup / restore / rollback

- migration前に shadow writer OFF・GC OFF・outbox queue 0・writer停止・schema/integrity/FK・disk free・quota/low-water・backup dir を確認。
- `VACUUM INTO` でWAL-safe backupを作成し、`quick_check`・schema contract・SHA-256・restore後hash一致を検証。backup evidenceは `operational_audit_events` にappend。
- backupは `backups/research-replay/` に保存しGitへは含めない。
- 失敗時はwriterを停止し空のN1 tableを読取対象にせずsidecarをbackupからrestoreする。primary DBのrollbackは不要。

## Restore-copy canary

backupから復元したrestore copy上でのみ検証し、完了後に破棄した。永続sidecarはzero-dataのまま維持。

- 20 fixture ingest（lineage・pin・parse error時のcandidate非生成）
- idempotent replay（同一observationの再appendでrow非増加）
- source conflict group / correction supersession
- evidence pin = candidate毎3行 / append-only trigger（UPDATE拒否）
- GC pin尊重（candidate参照rawはparse_run/observation経由で削除されない）
- restore copyの再backup/restoreでquick_check `ok`

## Post-migration gate（永続sidecar）

- schema version一致 / checksum一致（`35903…`） / partial・unknownなし
- `integrity_check = ok` / `foreign_key_check = 0` / append-only trigger 14
- F0 / F0-R / N1 reader互換 / shadow writer OFF / GC OFF / outbox queue 0
- N1 candidate 0 / payout line 0 / refund line 0 / conflict group 0（全7 table zero-data）
- primary schema・`app_settings` 不変

## 今回やっていないこと

8,164 archive full backfill / 永続candidate投入 / payout・refund投入 / future result collector / external HTTP / shadow writer ON / GC ON / primary DB migration / Legacy consumer切替 / Legacy ROI変更 / Phase N2 / model / production / 自動購入。

## N1-C eligibility → 実行済み

前提（quota引き上げ・Option B・0.2 checkpoint schema・executor）を満たし、N1-C Persistent Backfillを**実行した**。

- **Backfill execution: COMPLETE**（実行時manifest 8,167/8,167、現archive 8,168/8,168、failed 0）。
- **Overall N1-C: CONDITIONAL**（容量上振れ≈9.0GB→quota再評価、primary byte identity再分類、live archive日次incremental）。
- 正本: [`../reports/n1c-backfill/n1c-final-report.md`](../reports/n1c-backfill/n1c-final-report.md)、runbook: [`n1-settlement-backfill-runbook.md`](n1-settlement-backfill-runbook.md)、GC契約: [`n1-settlement-gc-safety-contract.md`](n1-settlement-gc-safety-contract.md)。

N1-C後のgate（GC・追加ingest前）:

1. quotaを 16 GB 以上、low-water 24 GB 以上へ再引き上げる（最終≈9.0GBに対し10GBは余裕不足）。
2. operational GC有効化は専用readiness gate + 別承認（GC安全契約参照）。
3. live archiveの日次incremental backfill運用（同executor、resumable）。
4. future result collector / N2 / production接続は別の明示承認。

## CLI

```sh
pnpm research:n1:rollout:capacity -- --write-reports    # 実archive sample容量benchmark
pnpm research:n1:rollout:readiness                       # 承認・gate確認（apply=false）
pnpm research:n1:rollout:apply -- --write-reports        # 承認済み時のみ zero-data schema適用
```
