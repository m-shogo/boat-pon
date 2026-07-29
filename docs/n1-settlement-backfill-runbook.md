# N1-C Persistent Backfill / Backup・Restore Runbook

更新: 2026-07-28
状態: **N1-C backfill 実行済み（run-time manifest 8,167/8,167）/ overall CONDITIONAL**

永続 Research Replay sidecar (`data/research-replay.sqlite`) への全券種 settlement backfill を、段階的・停止可能・冪等 resume で実行するための運用手順。`data/boat.sqlite` は一切書かない（read-only fingerprint 監視のみ）。collector / shadow writer / operational GC / production / 自動投票はすべて OFF のまま。

## 実行ドライバ

```bash
# PHASE 1 preflight（quota引き上げ含む。append-only config event、shadow/GC/killはOFF維持）
pnpm exec tsx scripts/research-replay-n1-backfill.ts preflight --raise-quota=32212254720
# PHASE 2 backup + restore drill
pnpm exec tsx scripts/research-replay-n1-backfill.ts backup
# PHASE 3 n1-settlement.0.2 expand-only migration（0.1不変・checkpoint table追加）
pnpm exec tsx scripts/research-replay-n1-backfill.ts migrate
# PHASE 4 Option B / implicit GC pin safety audit（temp DB）
pnpm exec tsx scripts/research-replay-n1-backfill.ts audit
# PHASE 5-9 段階 backfill（--target=完了させたい累計file数。冪等resume・guard付き）
pnpm exec tsx scripts/research-replay-n1-backfill.ts run --target=1     --primary-monitor=structural
pnpm exec tsx scripts/research-replay-n1-backfill.ts run --target=10    --primary-monitor=structural
pnpm exec tsx scripts/research-replay-n1-backfill.ts run --target=100   --primary-monitor=structural
pnpm exec tsx scripts/research-replay-n1-backfill.ts run --target=1000  --primary-monitor=structural
pnpm exec tsx scripts/research-replay-n1-backfill.ts run --target=8167  --primary-monitor=structural
# PHASE 10 検証・分解
pnpm exec tsx scripts/research-replay-n1-backfill.ts verify           # integrity/fk/dedup/coverage/schema/canonical invariant
pnpm exec tsx scripts/research-replay-n1-backfill.ts manifest         # 開始時 manifest（file数・総bytes・SHA）
pnpm exec tsx scripts/research-replay-n1-backfill.ts capacity         # 容量 dbstat 分解
pnpm exec tsx scripts/research-replay-n1-backfill.ts primary-identity # primary不変契約 再分類
pnpm exec tsx scripts/research-replay-n1-backfill.ts legacy-compare --sample=2000
# source-duplicate canonical resolution（append-only）
pnpm exec tsx scripts/research-replay-n1-backfill.ts resolve-source-duplicates            # dry-run（read-only、plan確認）
pnpm exec tsx scripts/research-replay-n1-backfill.ts resolve-source-duplicates --apply     # append-only 適用（冪等）
pnpm exec tsx scripts/analyze-n1c-reconciliation.ts                                        # raw + canonical reconciliation
```

## Schema / migration history

| version | checksum | 内容 | 適用 |
|---|---|---|---|
| `n1-settlement.0.1` | `35903ee1…` | settlement 7 table + evidence pins + conflict/resolution（append-only 14 trigger） | 永続適用済み（N1-B） |
| `n1-settlement.0.2` | `50d7e605…` | backfill checkpoint table（expand-only、append-only 2 trigger） | 永続適用済み（N1-C） |
| `n1-settlement.0.3` | `94c73e24…` | `settlement_source_duplicate_resolutions_v2`（expand-only、append-only 2 trigger、source-duplicate canonical mapping） | 永続適用済み（N1-C source-duplication closure） |

各 version は expand-only で下位 version の object を byte 単位で変更しない。checksum 不一致・unknown version・partial は default-deny。

レポートは `reports/n1c-backfill/*.json|md` に保存される。

## Guard（file境界で安全停止）

| guard | 条件 | 停止 code |
|---|---|---|
| disk floor | free < 20 GiB | `DISK_LOW` |
| quota 80% | dbBytes >= quota×0.8 | `QUOTA_80PCT` |
| projection | projected full > quota | `PROJECTED_EXCEEDS_QUOTA` |
| primary strict | boat.sqlite の size/mtime 変化 | `PRIMARY_DB_CHANGED` |
| primary structural | boat.sqlite の schema/app_settings hash 変化のみ（並行 data append は許容） | `PRIMARY_DB_CHANGED` |

- `--primary-monitor=strict`（既定）: boat.sqlite の size/mtime 変化で即停止。
- `--primary-monitor=structural`: 並行 collector（例: `bulk-fetch-racer-stats.ts`）の自然な data append を許容し、schema/app_settings 変化のみで停止。N1 の primary write=0 はコード構造で保証（backfill は boat.sqlite を一度も開かない）。

## 冪等 resume

- checkpoint は event-sourced append-only（`n1_settlement_backfill_checkpoints`）。`completed` の archive_file は skip。
- candidate は `UNIQUE(observation_id, bet_type, semantic_hash)` で重複不可。再実行は no-op。
- per-file 単一 transaction（`BEGIN IMMEDIATE`→ candidate/line/checkpoint →`COMMIT`）で file 境界 atomic。失敗 file は rollback で部分行を残さず、`failed` checkpoint を記録して次回再試行。
- プロセス kill 後も、完了済み file を再処理せず未完 file から再開する。

## Backup / Restore

```bash
# backup（VACUUM INTO、WAL-safe、SHA-256・quick_check・restore drill付き）
pnpm exec tsx scripts/research-replay-n1-backfill.ts backup
```

- backup は `backups/research-replay/`（Git管理外）。
- restore drill: 別location へ復元し `integrity_check` / `foreign_key_check` / schema checksum / row count 一致を確認。
- retention: 直近 3 世代以上を保持。

### Rollback 手順（緊急時）

1. writer プロセスを停止（backfill run を kill）。
2. `data/research-replay.sqlite` と `-wal` / `-shm` を退避。
3. 最新 backup を `data/research-replay.sqlite` へ copy。
4. `sqlite3 "file:data/research-replay.sqlite?immutable=1" "PRAGMA quick_check;"` で健全性確認（writer 静止時）。
5. `data/boat.sqlite` の rollback は不要（N1 は primary を書かない）。

## Incident recovery

- **PRIMARY_DB_CHANGED（strict）**: 並行ジョブ（racer-stats 等）が boat.sqlite を書いた場合。原因ジョブを特定し、`primary-identity` で schema/app_settings 不変・N1 write=0 を確認したうえで `--primary-monitor=structural` で resume。
- **DISK_LOW / QUOTA_80PCT / PROJECTED_EXCEEDS_QUOTA**: quota / disk を確保してから resume。GC は有効化しない（[[gc-safety-contract]] 参照）。
- **integrity/FK 異常**: 直ちに停止し backup から restore。checkpoint から未完 file を再実行。

## 静止時検証（writer 停止後）

- 読み取りは `file:...?immutable=1`（read-only）で行う。**writer 稼働中の immutable 読取は torn snapshot で "malformed" 偽陽性**になるため、必ず writer 停止後に行う。
- 権威ある `integrity_check` / `foreign_key_check` は run コマンド末尾（wal_checkpoint TRUNCATE 後）または `verify` コマンドで実施する。

## 実行実績（2026-07-27〜28）

- run-time manifest: **8,167 files**（k000101..k260725）、manifest 由来の per-file SHA を checkpoint に記録。
- 完了: **8,167 / 8,167**、failed 0、candidates 8,153,617、payout 11,072,266、refund 446,893、evidence pins **0**（Option B）。
- integrity ok / fk 0 / semantic duplicate 0 / append-only trigger 14+2。
- 停止事例: フル実行中に `bulk-fetch-racer-stats.ts` の並行 append で strict guard が `PRIMARY_DB_CHANGED` 停止（1,059件で安全停止・破損なし）→ structural 監視で resume し完走。
- k260726 以降の日次追加 file は live archive の incremental として同 executor で backfill する。

## Closure verification（2026-07-29）

- Debt A（8,168 authoritative full verify）解消: integrity ok / fk 0 / observation-level dup 0 / coverage 8,168/8,168 / pins 0。
- Debt B（+5,153 line reconciliation）解消: `analyze-n1c-reconciliation.ts` で archive を再parseし backfill と同一 classification を再現、unexplainedDelta=0 / simMatchesDb=true / parser determinism 0（`reports/n1c-backfill/reconciliation.json`）。
- **data-quality finding**: 4 source `.lzh`（2008-07-06/07-13, 2009-04-06/07-08）が日次データを intra-file 物理重複格納 → race-level 重複 candidate 4,196 / dup observation 624 / dup line 11,658。source-data defect・値誤りなし・完全説明済み。

## Source-duplication closure（2026-07-29、append-only）

- `n1-settlement.0.3` で `settlement_source_duplicate_resolutions_v2`（append-only）を追加し、624 races の重複 observation を `source_duplicate` として canonical original（source 順で最初の observation）へ mapping。
- raw 不変（observations 1,194,679 / candidates 8,154,709、raw 重複 624/4,196 は audit 可能）。active canonical 重複 **0/0**。inserted 624・rerun 0（冪等）・value conflict 0。
- 恒久 invariant: `verify` と reconciliation analyzer が active canonical race-level 重複 = 0 を強制。future ingest guard（`detectExactDuplicateObservationsInRaw`）で同種 duplication を検出（value 差は conflict path）。
- その後 live-archive の日次追加 k260727/728 を incremental backfill（8,170/8,170）。新 file に重複なし。
- 正本 `reports/n1c-backfill/data-quality-finding-duplicate-source-archives.md` / `reports/n1c-backfill/source-duplicate-resolution.json`。
