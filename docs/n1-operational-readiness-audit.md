# N1 Operational Readiness & Audit

更新: 2026-07-30
scope: read-only 監査（production/GC/collector/N2 未接続、破壊的変更なし）
current authority: このファイル + [`../reports/n1c-backfill/n1c-final-report.md`](../reports/n1c-backfill/n1c-final-report.md)

N1-C persistent sidecar（`data/research-replay.sqlite`）の運用準備・回復・容量・品質・不変条件を横断監査した結果。N1-C body は完成（verification debt 0）、formal acceptance は remote CI runner allocation（CI_INFRA_BLOCKED）のみで CONDITIONAL。

## 現在の authority snapshot（2026-07-30）

| 項目 | 値 |
|---|---|
| archive coverage | 8,170 / 8,170（failed 0、latest k260728） |
| DB bytes | 9,019,846,656（≈9.02GB）、page 4096、freelist 0、WAL/SHM 0 |
| candidates | 8,156,795 / observations 1,194,977 / payout 11,076,808 / refund 446,893 |
| evidence pins（explicit） | 0（Option B、implicit FK refs ≈24.47M） |
| canonical raw dup | observations 624 / race-level candidates 4,196（audit可能、保持） |
| canonical active dup | observations 0 / race-level candidates 0 |
| source_duplicate resolutions | 624（append-only、冪等） |
| schema | 0.1 `35903ee1…` / 0.2 `50d7e605…` / 0.3 `94c73e24…`（append-only 14+2+2） |
| integrity_check / foreign_key_check | ok / 0 |
| quota / disk free / low-water | 30 GB / ≈335 GB / 16 GB |
| collector / shadow / GC / production / auto-betting | all OFF |
| primary N1 write evidence | none |

## PHASE 3/4 — incremental readiness（daily archive追随）

- executor（`runBackfill`）は archive-file 単位 chunk・per-file 単一 transaction（BEGIN IMMEDIATE→candidate/line/checkpoint→COMMIT）・event-sourced checkpoint・冪等 resume（completed skip、UNIQUE で no-op）・file 境界 safe-stop。guard: disk floor / quota 80% / projection / primary strict|structural monitor。
- **daily 追随は full backfill と同規模ではない**。日次 1 file ≈ 142–180 races / ≈994–1,260 candidates / ≈1,420–1,800 payout line（実測、直近 k260720–728）。
- 追随手順: `run --target=<current count> --primary-monitor=structural`（新 file のみ処理、既存 skip）。新 file に重複がなければ `resolve-source-duplicates --apply` は no-op（冪等）。
- k260727/728 を実際に incremental 追随済み（8,170/8,170、新 file 重複なし、+2,086 candidates）。

## PHASE 3/9 — capacity growth 予測（観測ベース）

- bytes/candidate ≈ 1,106（9,019,846,656 / 8,156,795）。daily ≈1,050 candidates → **≈1.16 MB DB/day ≈ 0.42 GB/year**。raw store ≈169 KB decompressed/day（content-addressed）。
- headroom: quota 30 GB − 現 9.02 GB = 20.98 GB → **≈49 年分**の daily incremental。1週 ≈8MB / 1月 ≈35MB / 3月 ≈105MB / 6月 ≈210MB / 1年 ≈420MB。
- **quota/disk は当面 blocker ではない**。GC・大規模追加 ingest 前に disk low-water 16→24 GB を推奨（precondition のみ）。

## PHASE 9 — index cost（DROP しない、report のみ）

- tables 5.95 GB / indexes **3.07 GB（34%）** / freelist 0（fragmentation なし）。
- top index はすべて **PK/UNIQUE 制約 autoindex**（不変条件・冪等性の enforcement）または race 検索 index:
  - `sqlite_autoindex_settlement_candidates_v2_2`（UNIQUE observation_id,bet_type,semantic_hash＝idempotency invariant）1.14GB
  - payout PK/UNIQUE 556+535MB、candidate PK 394MB、`domain_observations_race_type_time` 89MB（canonical resolution/audit query に必須）ほか。
- **冗長・不要 index なし**。すべて invariant 保証か query 必須。削除候補は 0。

## PHASE 5 — observability metrics inventory

現状は read-only CLI で取得可能（`verify` / reconciliation analyzer / capacity / archive-quality-scan / primary-identity）。恒常監視に必要な metric とその取得元:

| 分類 | metric | 取得元 |
|---|---|---|
| coverage | discovered/completed/failed/pending | checkpoint（`completedCount`）+ `listArchiveFiles` |
| performance | files/min, rows/sec, duration/file | `runBackfill` summary（elapsedMs, throughput, healthChecks） |
| capacity | DB/table/index/WAL bytes, growth/day, free disk, quota usage | `capacity` command（dbstat）+ statfs |
| integrity | FK / semantic dup / canonical dup / dangling / conflict / checkpoint contradiction | `verify`（integrity/fk/dup/canonical audit） |
| source quality | duplicate day / malformed / value conflict / parse error | `archive-quality-scan` |
| canonical | raw vs active observations/candidates, resolutions | `auditCanonicalDuplicates` |
| primary isolation | schema/app_settings drift, N1 write evidence | `primary-identity` |

gap: 恒常的な time-series/alert 化は未実装（現状は on-demand CLI）。production 監視接続前に別途 lightweight metrics emitter を設計する（本監査では未実装、read-only CLI で代替可能）。

## PHASE 6 — backup / restore / disaster recovery

- **最重要**: sidecar は immutable な source archive（8,170 `.lzh`、全て保持）から `runBackfill`＋`resolve-source-duplicates`（deterministic）で**完全再構築可能**な derived artifact。source が truth。→ 究極の recovery path は re-backfill（≈103 分、resumable）。
- backup: 現在 `backups/research-replay/` に 0.1 zero-data 期の backup（430KB）が存在。**populated 9GB 状態の backup は未作成**（gap）。推奨: 定期 `research-replay-n1-backfill.ts backup`（VACUUM INTO、SHA-256・quick_check・restore drill 付き、≈9GB、~数分）で高速 restore point を作る（本監査では自動作成せず、operational task として明記）。
- failure scenario 対応（[`n1-settlement-backfill-runbook.md`](n1-settlement-backfill-runbook.md) Incident recovery 参照）: process kill mid-file→per-file atomic で部分行なし・resume / disk full・WAL 異常→guard で safe-stop / corrupt→backup restore or re-backfill / broken checkpoint→event-sourced 再開 / source replaced or malformed→archive-quality-scan で検出＋source_duplicate/conflict / schema migration failure→transaction rollback / concurrent writer→busy_timeout+primary guard / primary changed→structural monitor / backup corrupt→re-backfill / CI unavailable→本 acceptance の CI_INFRA_BLOCKED。

## PHASE 7 — canonical resolution deep audit

- `source_duplicate` は 4 file 固有ではなく一般化実装（`planSourceDuplicateResolution` は全 duplicate race を検出）。deterministic canonical = source 順で最初の observation（rowid 昇順、timestamp 非依存）。
- exact semantic equality（candidate 集合一致）を必須にし、value 差は resolution せず conflict/停止（`applySourceDuplicateResolution` が throw）。append-only・FK・UNIQUE(duplicate_observation_id) で冪等・resolution cycle 不能・canonical missing 不能。
- future ingest guard `detectExactDuplicateObservationsInRaw`（同一 raw 内の exact dup 検出、value 差は conflict path）。
- test coverage: `n1CanonicalResolution.test.ts`（expand-only/checksum default-deny/exact→raw保持・canonical unique・冪等/value差→conflict拒否/future guard）。

## PHASE 8 — data-quality deep scan（全 8,170 archive、read-only）

`../reports/n1c-backfill/archive-quality-scan.json` 正本。

| finding | class | count | 対応 |
|---|---|---:|---|
| duplicate day sections | CONFIRMED | 4 | source_duplicate canonical resolution 済み |
| parse errors | EXPECTED | 0 | — |
| zero-race files | EXPECTED | 3 | k110313/k110314（2011東日本大震災）, k040830（台風）＝競走中止日。0 candidate で正常 ingest |
| invalid venue / raceNo | EXPECTED | 0 / 0 | — |
| oversized decompressed | UNKNOWN | 156 | 大半は開催多数日（正常）。うち 4 が duplicate（解決済み）。bug 断定せず |
| undersized decompressed | UNKNOWN | 35 | 少開催日（正常）。bug 断定せず |

**新規 unresolved defect = 0**。4 duplicate 以外に source defect は検出されず。

## PHASE 10 — GC readiness（OFF 維持）

- freelist 0 のため GC で回収可能な page は現状ほぼ無い（容量対策としての GC 有効化は根拠なし）。
- raw truth（重複含む）を消す GC は禁止。canonical resolution は raw を保持し active view のみ除外する設計であり、GC とは独立。
- GC 有効化 gate（[`n1-settlement-gc-safety-contract.md`](n1-settlement-gc-safety-contract.md)）: candidate FK（implicit pin）+ source_duplicate resolution 参照 + superseded observation を GC 参照集合へ含める回帰テスト、restore-copy 実削除 canary、別承認。**本監査でも GC は有効化しない**。

## PHASE 13 — tests coverage map（464 tests）

| contract | coverage | test |
|---|---|---|
| schema 0.1/0.2/0.3 expand-only・checksum default-deny | covered | settlement/n1Backfill/n1CanonicalResolution test |
| append-only trigger | covered | 各 test |
| FK / integrity | covered | 各 test + verify |
| checkpoint event-sourcing / resume / idempotency | covered | n1Backfill.test |
| parser 7券種 / archive | covered | settlement.test |
| canonical source_duplicate / value conflict / future guard | covered | n1CanonicalResolution.test |
| reconciliation raw/canonical | covered（analyzer 実行時） | analyze-n1c-reconciliation |
| PIT / leakage sentinel | covered | settlement.test（post_race） |
| primary isolation | covered（CLI） | primary-identity |
| capacity guard / safe-stop | partial（guard は実装、unit は run 経由） | n1Backfill.test（archive-gated） |
| backup/restore | covered（CLI） | backup command / F0-R test |
| GC safety | covered（F0-R canary） | rollout.test |

gap: capacity guard の純 unit（disk floor/quota trip）は run 経由の間接検証のみ。重要度中。将来 lightweight unit を追加余地あり（本監査では未追加）。

## 結論

N1-C body の運用準備は良好。唯一の formal blocker は remote CI（CI_INFRA_BLOCKED）。推奨 operational follow-up（いずれも COMPLETE の blocker ではない）: populated-state backup の定期化、disk low-water 24GB 化、metrics emitter の設計、capacity guard の unit test 追加。GC・future collector・N2 は別承認。
