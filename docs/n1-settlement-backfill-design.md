# N1-C Historical Backfill 契約（設計のみ・未実行）

更新: 2026-07-25
状態: **DESIGN ONLY / NOT EXECUTED**

N1-Bで永続sidecarへ `n1-settlement.0.1` schemaをzero-dataで適用した。本書はN1-Cで8,164 archiveをbackfillする際のchunk/checkpoint契約だけを確定する。実backfill・candidate投入・collector接続はN1-Cの別の明示承認まで行わない。

## 前提gate（N1-C開始条件）

1. quota ≈17 GB / low-water ≈34 GB へ引き上げ（capacity benchmark根拠、[`n1-settlement-permanent-rollout.md`](n1-settlement-permanent-rollout.md)）。
2. evidence pin Option B適用（下記）。
3. 本契約のcheckpoint executor実装＋temp/restore-copy検証。
4. source correction運用と future collectorは別承認。

## Evidence pin Option B（version bump `n1-settlement.0.2`）

- appendCandidateの per-candidate explicit pin書込み（raw/parse/observation 3行）を廃止する。GC pin安全性はcandidateの `ON DELETE RESTRICT` FK（raw_document_id / parse_run_id / observation_id）で担保する。
- `settlement_evidence_pins_v2` tableは将来のcohort/evaluation pin用に残す（自動投入しない）。
- 適用条件: temp migration PASS / old N1-A fixture PASS / migration checksum更新 / schema version bump / 理由文書化 / golden・F0 hash不変 / 永続sidecar適用前。
- 効果（sample projection根拠）: 約23M重複pin行を削減、DBを約33%圧縮（≈10.5GB→≈7GB台）。

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

## 再実行冪等性

- candidate一意性は `UNIQUE(observation_id, bet_type, semantic_hash)`。同一raw/parser/race/bet-type/hashの再実行は no-op（既存candidate_idを返す）。
- chunk checkpointが `completed` のarchive_fileはskipする。`failed`/未記録のみ再処理する。
- 途中失敗したchunkはtransaction rollbackで部分行を残さず、resume_tokenから再開する。
- 同一source revisionで異なるhashは `source_conflict` group（自動優先なし）。後日の公式訂正は `corrected` + `supersedes_candidate_id`。

## Transaction境界

- 1 archive file（≈146 races、≈900 candidates）を1 batchとしBEGIN IMMEDIATE→commit。
- commit毎にcheckpoint recordをappendし、WALは file単位でcheckpointされ約4MBに収まる（benchmark WAL peak ≈4.2MB）。
- backfill全体で projected candidate ≈7.67M / payout line ≈10.73M。

## 実行しないもの（本フェーズ）

full backfill実行 / candidate・payout・refund投入 / future result collector / external HTTP / shadow writer ON / GC ON / Legacy切替。本書はN1-Cの契約確定のみ。
