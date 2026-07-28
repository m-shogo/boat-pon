# 容量分解（9.0GB上振れ）

- DB file: 8.40 GiB / WAL: 0 / SHM: 32768
- page_count×page_size: 2201405×4096 = 9016954880
- freelist(frag): 0 pages (0.0 MB, 0.00%)
- tables: 5.54 GiB / indexes: 2.86 GiB (34.0% overhead)
- candidates: 8154709 / avg candidate table row: 411 B / avg payout line row: 142 B
- projection: 5.38GB → 8.40GB (+68%); reason: sample benchmark was decade-stratified (early legacy files sparse: 4 bet types, fewer races); full archive is dominated by modern all-7-bet-type dense days, raising avg bytes/race. Index overhead (UUID PKs + 64-hex hashes) and per-row STRICT TEXT columns amplify at scale.
- quota reassessment: final ~9.0GB; a 10GB quota leaves <1GB headroom (insufficient for GC scratch / additional ingest). Recommend raising quota to >=16GB and low-water >=24GB before enabling GC or any further ingest.

## Top tables
- settlement_candidates_v2: 3194.1 MB
- race_payout_lines_v2: 1495.3 MB
- domain_observations: 519.8 MB
- typed_observation_payloads: 389.9 MB
- race_refund_lines_v2: 67.8 MB
- parse_runs: 2.9 MB
- raw_documents: 2.7 MB
- n1_settlement_backfill_checkpoints: 2.5 MB
- sqlite_schema: 0 MB
- operational_audit_events: 0 MB
- asof_resolution_policies: 0 MB
- capture_attempt_events: 0 MB

## Top indexes
- sqlite_autoindex_settlement_candidates_v2_2: 1138.2 MB
- sqlite_autoindex_race_payout_lines_v2_2: 556 MB
- sqlite_autoindex_race_payout_lines_v2_1: 534.9 MB
- sqlite_autoindex_settlement_candidates_v2_1: 394.3 MB
- domain_observations_race_type_time: 89.2 MB
- sqlite_autoindex_domain_observations_1: 82.1 MB
- sqlite_autoindex_typed_observation_payloads_1: 82.1 MB
- sqlite_autoindex_race_refund_lines_v2_2: 22.2 MB
- sqlite_autoindex_race_refund_lines_v2_1: 21.5 MB
- sqlite_autoindex_raw_documents_3: 0.8 MB
- sqlite_autoindex_raw_documents_2: 0.7 MB
- sqlite_autoindex_parse_runs_1: 0.5 MB
