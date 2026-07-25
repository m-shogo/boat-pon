# N1-C Historical Backfill 契約（executor実装済み・実backfill未実行）

更新: 2026-07-25
状態: **EXECUTOR IMPLEMENTED & TEMP/RESTORE-VERIFIED / FULL BACKFILL NOT EXECUTED**

N1-Bで永続sidecarへ `n1-settlement.0.1` schemaをzero-dataで適用した。本書はN1-Cで8,164 archiveをbackfillする際のchunk/checkpoint契約を確定し、その executor・Option B writer・`n1-settlement.0.2` checkpoint schema を実装してtemp/restore-copyで検証した状態を記録する。永続sidecarへの実backfill・candidate投入・0.2適用・collector接続はN1-Cの別の明示承認まで行わない。永続sidecarは現在も全N1 table **0件**である。

## 実装状態（2026-07-25 N1-C準備）

| 項目 | 状態 | 実装 |
|---|---|---|
| Option B writer（explicit pin廃止） | **実装済み** | `SettlementRepository.appendCandidate({ emitEvidencePins })`。既定`true`でN1-A挙動不変、backfillは`false` |
| `n1-settlement.0.2` checkpoint schema | **実装済み・temp検証** | `initializeN1BackfillSchema` / `verifyN1BackfillSchema`（expand-only、0.1不変、永続未適用） |
| backfill checkpoint repository | **実装済み** | `BackfillCheckpointRepository`（event-sourced append-only） |
| backfill executor | **実装済み・sample検証** | `runBackfill` / `ingestArchiveFile`（`data/research-replay.sqlite`未接続） |
| 容量再実測（Option B） | **実測済み** | `research:n1:rollout:capacity`がexplicit/implicitを同一sampleで比較 |
| 永続 0.2適用・実8,164 backfill | **未実行** | N1-C承認・quota引き上げ待ち |

## 前提gate（N1-C開始条件）

1. quota引き上げ（Option B採用時は base≈5.4 GB / high≈6.7 GB のため **≈10 GB quota / low-water ≈16 GB** を推奨。explicit継続なら ≈17 GB / ≈34 GB）。capacity根拠は[`../reports/n1-settlement-capacity-benchmark.md`](../reports/n1-settlement-capacity-benchmark.md)。
2. 永続sidecarへ `n1-settlement.0.2`（checkpoint table）を expand-only 適用（backup付き、N1-B同型gate）。
3. backfillは Option B（`emitEvidencePins=false`）で実行。
4. source correction運用と future collectorは別承認。

## Evidence pin Option B（writer変更・schema非破壊）

- **writer-levelの変更**であり0.1 schema SQLは不変（checksum `35903…` 維持）。`appendCandidate` の per-candidate explicit pin書込み（raw/parse/observation 3行）を `emitEvidencePins=false` で抑止する。
- GC pin安全性はcandidateの `ON DELETE RESTRICT` FK（raw_document_id / parse_run_id / observation_id）で担保する（候補が存在する限り参照evidenceは削除不可＝暗黙pin）。
- `settlement_evidence_pins_v2` tableは将来のcohort/evaluation pin用に残す（backfillでは自動投入しない）。
- 既定`true`のためN1-A 20-case fixtureとcanaryは3 pin/candidateのまま不変（後方互換）。
- **実測効果**（同一sample・explicit vs implicit）: sample DB **101,982,208 → 52,379,648 bytes（-48.6%）**、evidence pin **44,844 → 0**、projected full DB **base ≈10.48 GB → ≈5.38 GB**（low ≈4.57 / high ≈6.73 GB）。約19M重複pin行を削減。
- `n1-settlement.0.2` の version bumpは **checkpoint table追加（expand-only）** に対して発行するものであり、Option B自体はschema非破壊。

## Chunk / checkpoint契約

backfillは **archive file単位** をchunkとし、1ファイル=1 transaction batchで処理する。8,164ファイルを1つの巨大transactionにまとめることを禁止する。

checkpoint record（1 chunk = 1 archive file）に最低限保持する項目:

| 項目 | 説明 |
|---|---|
| `archive_file` | 例 `k260722.lzh` |
| `source_archive_sha256` | 圧縮archiveのSHA-256（source同一性） |
| `parser_version` | `n1-settlement-parser-v1` 等 |
| `source_schema_family` | `modern_seven_display` / `legacy_pre_trifecta` / `unknown` |
| `first_race_key` / `last_race_key` | canonical race key境界 |
| `expected_race_count` / `parsed_race_count` | 期待/実パース race数 |
| `candidate_count` | 生成candidate数 |
| `payout_line_count` / `refund_line_count` | line数 |
| `transaction_batch_size` | 1 commit当たりのcandidate上限 |
| `commit_checkpoint` | commit境界（file末尾） |
| `resume_token` | 再開位置（次archive_file） |
| `state` | `completed` / `failed` / `quarantined` |
| `retry_count` / `failure_reason` | 再試行数・失敗理由 |
| `created_at` / `completed_at` | 時刻 |
| `migration_version` / `schema_version` | 適用schema |

## 再実行冪等性（sample検証済み）

- candidate一意性は `UNIQUE(observation_id, bet_type, semantic_hash)`。同一raw/parser/race/bet-type/hashの再実行は no-op（既存candidate_idを返す）。
- chunk checkpointが `completed` のarchive_fileはskipする。`failed`/未記録のみ再処理する。checkpointは event-sourced append-only（1試行=1 row、最新rowが有効、`retry_count`加算）。
- candidateは `appendCandidate` が1件ずつ `BEGIN IMMEDIATE` するため、chunk途中失敗時も既存candidateはUNIQUEでno-op、未完checkpointの再処理で重複を作らない。
- 同一source revisionで異なるhashは `source_conflict` group（自動優先なし）。後日の公式訂正は `corrected` + `supersedes_candidate_id`。
- **sample検証**: `research:n1:rollout:backfill-sample --max-files=3` で 3 file→1,820 candidate / pin **0** / 再実行 `skippedCompleted=3` かつ candidate不変 / `foreign_key_check=0` を確認。

## Transaction境界

- 1 archive file（≈146 races、≈900 candidates）を chunk とする。`transaction_batch_size` はcheckpointに記録（既定1000）。
- WALは file単位でcheckpointされ約4MBに収まる（benchmark WAL peak ≈4.2MB）。
- backfill全体で projected candidate ≈7.67M / payout line ≈10.73M / evidence pin **0（Option B）**。

## 実装参照

| module | 役割 |
|---|---|
| `src/research-replay/settlement.ts` | `emitEvidencePins`、`initializeN1BackfillSchema`、`verifyN1BackfillSchema`、`BackfillCheckpointRepository` |
| `src/research-replay/n1Backfill.ts` | `runBackfill` / `ingestArchiveFile` / `listArchiveFiles` |
| `scripts/research-replay-n1-rollout.ts` | `capacity-benchmark`（Option B比較）、`backfill-sample`（temp検証） |
| `src/research-replay/n1Backfill.test.ts` | 0.2 expand-only / checksum default-deny / checkpoint event-sourcing / Option B pin=0・冪等 |

## 実行しないもの（本フェーズ）

full backfill実行（実8,164 file投入）/ 永続sidecarへの0.2適用 / candidate・payout・refund投入 / future result collector / external HTTP / shadow writer ON / GC ON / Legacy切替。本フェーズはN1-C準備（executor実装＋temp検証）のみで、実backfillは別承認を待つ。
