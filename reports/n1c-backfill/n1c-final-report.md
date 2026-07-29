# N1-C Persistent Sidecar Backfill — 最終実行レポート

更新: 2026-07-28

## 判定（2026-07-29 closure 更新）

- **Backfill execution: COMPLETE**（現archive 8,168/8,168、failed 0）
- **Final verification: COMPLETE**（現 8,168 state に対する authoritative full verify を完走: integrity ok / fk 0 / observation-level dup 0 / coverage 8,168/8,168 / schema checksum 一致）
- **Reconciliation (+5,153): COMPLETE**（unexplainedDelta=0、simMatchesDb=true、parser determinism 0）
- **N1-C acceptance: CONDITIONAL**
- **Overall N1-C: CONDITIONAL**

2つの verification debt（A: 8,168 authoritative full verify / B: +5,153 完全 reconciliation）は**解消**した。ただし reconciliation が新たな data-quality finding を surface したため、COMPLETE へは昇格しない。

CONDITIONAL の理由:

1. **【新】source archive 重複（COMPLETE を阻む主因）**: 4 file（2008-07-06/07-13, 2009-04-06/07-08）が単一 `.TXT` 内に日次データを物理重複格納。N1 は faithful に取り込み、**race-level 重複 candidate 4,196 / 重複 observation 624 / 重複 line 11,658**（store の約 0.05%）が残る。source-data defect（N1 pipeline bug ではない）・値誤りなし（legacy mismatch 0）・reconciliation で完全説明済み（unexplained=0）だが、race 単位の重複が未解決。正本: [`data-quality-finding-duplicate-source-archives.md`](data-quality-finding-duplicate-source-archives.md)。破壊的修正は行わない。
2. **対象差分 8,164→8,167→8,168**: K archive は live で日次増加。継続的 incremental backfill が前提。
3. **容量上振れ 5.38GB→約9.0GB（+67.5%）**: quota 再評価が必要（GC・追加 ingest 前に quota ≥16GB / low-water ≥24GB）。
4. **primary byte identity FAIL**: 並行 racer-stats append による。structural/schema/app_settings identity は PASS、writer 静止 2 点で安定、N1 の primary write は 0。「primary 完全不変」ではない。

## Closure verification（2026-07-29）

| debt / phase | 結果 | 証跡 |
|---|---|---|
| Debt A: 8,168 authoritative full verify | **RESOLVED** | integrity ok / fk 0 / obs-level dup 0 / coverage 8,168/8,168 / pins 0（`phase10-verify.json`） |
| Debt B: +5,153 reconciliation | **RESOLVED** | unexplainedDelta 0 / simMatchesDb true / parser determinism 0（`reconciliation.json`） |
| 新 finding: 4-file source 重複 | **報告・未修正** | 4,196 dup candidate / 624 dup obs / 11,658 dup line（`data-quality-finding-...md`） |
| Phase 3 primary quiescent 2-point | **PASS** | twoPointStable true / structural・schema・appSettings PASS / N1 write none（`primary-identity.json`） |
| Phase 5 regression | **PASS** | 459 tests / tsc×2 / build / golden / db:health / validate:data / secret scan 0 |

## 1. 対象差分の確定（8,164 → 8,167 → 8,168）

`reports/n1c-backfill/manifest.json`（現時点）:

- 現 archive file 数: **8,168**、総 bytes 295,456,988、manifest SHA-256 `c44bfb6fdda7728ee2bdc58d48d9378a48617d6ce95b61a84c15a8c2e934c1a1`
- baseline snapshot（2026-07-24, N1-A audit）: 8,164（last `k260722.lzh`）
- baseline 超過の追加日次 file（daily公式Kアーカイブの通常成長）:
  - `k260723.lzh`（37,499 B）/ `k260724.lzh`（43,308 B）/ `k260725.lzh`（43,077 B）/ `k260726.lzh`（36,756 B）
- 差分理由: **auxiliary/sanitized fixture ではない・重複パスではない・対象定義変更でもない**。通常の日次パイプラインが snapshot 後に追加した標準的な日次結果アーカイブ。
- **backfill 実行時点の対象は 8,167**（k000101..k260725）。各 file の source SHA-256 は checkpoint（`n1_settlement_backfill_checkpoints.source_archive_sha256`）に固定済み。実行後に `k260726` が到着し、incremental で適用（現 8,168/8,168）。

## 2. 容量上振れの分解（5.38GB 予測 → 約9.0GB 実測）

`reports/n1c-backfill/capacity-decomposition.json` を正本とする。実測:

- DB file **9,016,954,880 B（≈9.0GB）** = page_count 2,201,405 × page_size 4,096。WAL 0 / SHM 32,768。
- tables **5.95GB** / indexes **3.07GB（index overhead 34%）**。freelist 0 pages（**fragmentation 0**、逐次insertで高密度）。
- avg candidate table row **411 B** / avg payout line table row **142 B**（table only、index除く）。
- 予測 5,381,780,085 B → 実測 9,016,954,880 B、delta **+3.64GB / +67.5%**。

主因:

- sample benchmark は decade-stratified で、早期 legacy file（4券種・レース少）が平均を押し下げていた。full archive は modern の全7券種・高密度日が支配的で bytes/race が上昇。
- UUID 主キー（36B）+ 64桁hex hash + STRICT TEXT 列が 8.15M candidate / 11M payout line 規模で増幅。index overhead（UUID PK index 群）も大きい。
- WAL/SHM は checkpoint 後 0。DB 本体 = page_count × page_size。free page/fragmentation は capacity-decomposition の `freelistBytes` 参照。

**quota 再評価**: 最終約9.0GB に対し quota 10GB は運用余裕がほぼ無い。**GC・追加 ingest を開始する前に quota を 16GB 以上・low-water 24GB 以上へ再引き上げ**すること（本 backfill 時点の設定 quota は 30GB へ引き上げ済み、余裕あり）。

## 3. primary 不変契約の再分類

`reports/n1c-backfill/primary-identity.json`:

| 分類 | 結果 |
|---|---|
| `primaryByteIdentity`（vs 開始前 snapshot） | **FAIL** |
| `primaryStructuralIdentity` | **PASS** |
| `primarySchemaIdentity` | **PASS** |
| `appSettingsIdentity` | **PASS** |
| `unexpectedPrimaryMutation` | **0** |
| `knownConcurrentMutation` | `bulk-fetch-racer-stats.ts` の racer_profiles/racer_course_stats への append |
| `backfillPrimaryWriteEvidence` | **none** |

- backfill プロセスは `data/boat.sqlite` を**書き込みで一度も開かない**（コード構造で保証）。probe は read-only URI + `PRAGMA query_only=ON`、writeSQL=0 / writeConn=0 / attached=[] / researchTablesInPrimary=0。
- writer（並行 racer-stats）静止後の 2 時点で size/mtime **安定**（`twoPointQuiescentStable=true`）。quiescent SHA-256 `30df0dae…`（開始前 `a9d76d88…` から並行 append で変化）。
- phase0 baseline: size 15,134,183,424 / SHA `a9d76d88d6975d34543f27ac8cc679833b7914216e119bb06e125c595bce7797`。

## Phase 10 合格条件

| 条件 | 結果 | 根拠 |
|---|---|---|
| integrity_check = ok | **ok** | 8,167 verify + 各milestone run末尾 |
| foreign_key_check = 0 | **0** | 同上 |
| semantic duplicate = 0 | **0** | distinct=candidates（8,153,617）。UNIQUE制約で構造的保証 |
| schema checksum一致 | **PASS** | 0.1 `35903ee1…` / 0.2 `50d7e605…` |
| append-only trigger定義一致 | **14 + 2** | 0.1 evidence 7×2 / 0.2 checkpoint 1×2 |
| checkpoint 8,167/8,167 | **PASS** | 実行時 manifest 完全。現 8,168/8,168（k260726 増分） |
| unresolved failure = 0 | **0** | failed checkpoint 0 |
| deterministic rerun 追加行 0 | **PASS** | rerun: processed 0 / skipped 8,168 / new candidate 0 |
| explicit evidence pins = 0 | **0** | Option B |
| candidate参照切れ = 0 | **0** | fk_check 0 / implicit FK refs 24,460,851 |
| source archive件数 reconciliation | **PASS** | observations 1,194,523 ≈ races、payout 11,072,266 + refund 446,893 = 11,519,159 ≈ archive 11,514,006 lines |
| legacy payout mismatch 0 | **0** | sample 2,000: exact 1,428 / mismatch 0 / n1-only 572（多line被覆域） |
| tests/typecheck/build/golden/db health/data validation | **全PASS** | 459 tests / tsc×2 / build / golden ok / db:health / validate:data |
| secret scan 0 | **PASS** | changed-diff gitleaks 0 |
| writer静止後 primary不変 | **structural PASS / byte FAIL(既知並行append)** | primary-identity 参照 |

> 注: k260726 増分（+1,092 candidate）は atomic・FK 強制の 1-file append であり、9GB 全 `integrity_check`/`foreign_key_check` の**再走査は冗長のため意図的に skip**した。full 検査は 8,167（全データの 8,167/8,168）で 2 度（最終 run 末尾 + verify）PASS 済み。

## データ集計

- candidates: **8,154,709**（8,167: 8,153,617 + k260726: 1,092）
- payout lines: 11,072,266（8,167時点）/ refund lines: 446,893（8,167時点）+ k260726増分
- observations 1,194,523 / parse_runs 8,167 / raw_documents 8,167（+k260726）/ conflict groups 0
- by status（8,167）: settled 7,833,938 / refunded 319,678 / partially_refunded 1
- by bet type（8,167）: exacta 1,190,198 ほか全7券種
- final DB: 約 9.0 GB（page_count×page_size）、WAL/SHM 0（checkpoint後）

## 安全境界

- `data/boat.sqlite`: N1 write 0（read-only fingerprint のみ）。byte は並行 racer-stats で変化、structural/schema/app_settings 不変。
- collector / shadow writer / operational GC / production 接続 / 自動投票: すべて **OFF**（未起動）。
- backup: `reports/n1c-backfill/phase2-backup.json`（migration 前）。retention 3 世代以上。rollback 手順は [`../../docs/n1-settlement-backfill-runbook.md`](../../docs/n1-settlement-backfill-runbook.md)。

## 次段階（N1-C 後の gate）

1. quota 16GB+ / low-water 24GB+ へ再引き上げ（GC・追加 ingest 前）。
2. live archive の日次 incremental backfill 運用（同 executor、resumable）。
3. operational GC 有効化には専用 readiness gate（[`../../docs/n1-settlement-gc-safety-contract.md`](../../docs/n1-settlement-gc-safety-contract.md)）+ 別承認。
4. future result collector / N2 / model / production 接続は別承認。
