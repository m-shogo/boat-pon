# N1-C Persistent Sidecar Backfill — 最終実行レポート

更新: 2026-07-28

## 判定（2026-07-29 source-duplication closure 更新）

- **Backfill execution: COMPLETE**（現archive 8,170/8,170、failed 0）
- **Final verification: COMPLETE**（現 8,170 state authoritative full verify: integrity ok / fk 0 / observation-level dup 0 / coverage 8,170/8,170 / schema 0.1/0.2/0.3 checksum 一致 / canonical race-level invariant OK）
- **Reconciliation: COMPLETE**（raw: unexplainedDelta=0・simMatchesDb=true・parser determinism 0 / canonical: sourceDuplicateExcludedCandidates 4,196=rawRaceLevelDuplicateCandidates 4,196・unexplainedCanonicalDelta=0）
- **Source duplication resolution: COMPLETE**（append-only、raw immutable、active canonical 0/0、冪等、value conflict 0）
- **N1-C acceptance: CONDITIONAL（理由 CI_INFRA_BLOCKED）**
- **Overall N1-C: CONDITIONAL（CI_INFRA_BLOCKED のみ）**

N1-C 本体の verification debt は **0**。closure verification で発見した source archive 重複を append-only の canonical resolution で解決し、raw provenance を保持したまま active canonical 重複を 0 にした。全 local gate（verify COMPLETE / canonical invariant / reconciliation / primary isolation / 464 tests / build / golden / db:health / validate:data / secret scan）が PASS。**COMPLETE を阻む唯一の要因は remote CI の runner allocation failure（infra、code failure ではない）**であり、GitHub Actions minutes/billing 等のユーザー操作または GHA infra 復旧後に HEAD で CI を再実行し success すれば COMPLETE となる。

### 過去に CONDITIONAL 要因だった項目の解消

1. **source archive 重複 → RESOLVED**: 4 file（2008-07-06/07-13, 2009-04-06/07-08）が単一 `.TXT` 内に日次データを物理重複格納（source-data defect、N1 pipeline bug ではない、値誤りなし）。raw の重複 observation 624 / candidate 4,196 / line 11,658 は**削除せず audit-visible のまま保持**し、`n1-settlement.0.3` の `settlement_source_duplicate_resolutions_v2`（append-only）で重複 observation を `source_duplicate` として canonical original（source 順で最初の observation）へ mapping。**active canonical 重複 observation 0 / candidate 0**。inserted 624・rerun 0（冪等）・value conflict 0（624 races で candidate 集合完全一致を事前検証）。正本: [`data-quality-finding-duplicate-source-archives.md`](data-quality-finding-duplicate-source-archives.md) / [`source-duplicate-resolution.json`](source-duplicate-resolution.json)。
2. **対象差分（live archive 成長）→ 追随済み**: k260727/728 を incremental backfill し 8,170/8,170。以後の日次 file も同 executor で resumable に追随する（運用継続項目、COMPLETE の blocker ではない）。
3. **容量**: DB ≈9.02GB に対し quota 30GB / filesystem free ≈354GB で充足。**COMPLETE の blocker ではない**。GC・追加 ingest 開始前に low-water ≥24GB を推奨（precondition、blocker ではない）。
4. **primary byte identity FAIL**: 並行 racer-stats append による。structural/schema/app_settings identity は PASS、writer 静止 2 点で安定、N1 の primary write は 0。「primary 完全不変」ではない（正確表現）。COMPLETE の blocker ではない。

### 唯一残る gate: remote CI（CI_INFRA_BLOCKED）

- run 30458083742（HEAD `4555cd4`）ほか計 ~6 回の attempt すべて **runner allocation failure**（conclusion=failure, steps=0, runner=""）。
- Actions は enabled、workflow ci.yml は最後の成功以降 **未変更**、local regression は全 PASS → **code failure ではなく GitHub Actions の runner allocation / minutes / infrastructure の問題**。
- 復旧手順（ユーザー操作）: GitHub Actions の minutes/billing を確認、または GHA infra 復旧を待ち、HEAD で CI を再実行して success を確認する。success した時点で N1-C acceptance = COMPLETE。

## Closure verification（2026-07-29）

| phase | 結果 | 証跡 |
|---|---|---|
| authoritative full verify（8,170） | **PASS** | integrity ok / fk 0 / obs-level dup 0 / coverage 8,170/8,170 / pins 0 / schema 0.1/0.2/0.3 / canonicalRaceLevelInvariantOk true（`phase10-verify.json`） |
| +5,153 reconciliation（raw） | **RESOLVED** | unexplainedDelta 0 / simMatchesDb true / parser determinism 0（`reconciliation.json`） |
| source 重複 finding | **RESOLVED_CANONICALLY** | raw 624 obs / 4,196 candidate 保持・audit可能、active canonical 0/0、append-only 624 resolutions・冪等（`data-quality-finding-...md` / `source-duplicate-resolution.json`） |
| canonical reconciliation | **PASS** | sourceDuplicateExcludedCandidates 4,196 = rawRaceLevelDuplicateCandidates 4,196 / unexplainedCanonicalDelta 0 |
| primary quiescent 2-point | **PASS** | twoPointStable true / structural・schema・appSettings PASS / N1 write none（`primary-identity.json`） |
| regression | **PASS** | 464 tests / tsc×2 / build / golden / db:health / validate:data / secret scan 0 |
| remote CI | **PENDING** | 直近 runner allocation failure、再実行で判定 |

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
