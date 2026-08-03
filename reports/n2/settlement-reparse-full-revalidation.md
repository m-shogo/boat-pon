# Settlement reparse (temp-copy, full)

- generated: 2026-08-03T08:03:43.824Z
- mode: simulated (production apply BLOCKED)
- as-of: 2026-08-01T00:00:00.000Z
- source: /Users/m-shogo/Developer/personal/boat-pon/data/research-replay.sqlite
- source sha256: d9b5ddd264ea138f319b04a8fb9398f1048bb2ad3001055ffe319616d6b6cb92
- target: /Users/m-shogo/Developer/personal/boat-pon/data/tmp/reparse-full2.sqlite
- target final sha256: fd0e764109287d5f839ba6fa9ed6e0353166786b5c47492d6533e091e0008edc
- defect: V1_SPECIAL_PAYOUT_FALSE_REFUND
- source parser: n1-settlement-parser-v1 → target parser: n1-settlement-parser-v2
- output digest: 247310fbd8bc40db54568b0d0d3e84d823fd3da1a551c192cad2ff775a9a090f
- result: REPARSED_WITH_FLAGS

## Actions

| action | count |
|---|---:|
| exact | 7834852 |
| false_refund_correction | 317747 |
| result_kind_correction | 0 |
| special_payout_addition | 65156 |
| ambiguous_non_defect | 0 |
| unexpected_addition | 2 |

## Appends (append-only)

- appended candidates 382903 / supersession relations 317747 / parse_runs 8167 / observations 58542

## Files

- scanned 8174 / ingested 8167 / not_ingested(backfill gap) 7 / duplicate_source 0 / parse_errors 0

## Active candidate counts (logical)

| status | before | after (delta) | after (measured) |
|---|---:|---:|---:|
| settled | 7833297 | 8216200 | 8216200 |
| refunded | 319301 | 1554 | 1554 |
| partially_refunded | 1 | 1 | 1 |
| **logical total** | 8152599 | 8217755 | |

- after delta == measured: true
- physical settlement_candidates_v2 rows: before 8156795 → after 8539698
- ambiguous active keys: 0

## Second run (idempotency)

- appended 0 (expect 0) / supersessions 0 (expect 0)

## Integrity

- light: {"multipleActiveSuccessors":0,"selfSupersedingCycles":0,"danglingSupersedes":0}
- append-only enforcement: {"updateBlocked":true,"deleteBlocked":true}
- full: {"integrityCheck":"ok","foreignKeyViolations":0,"orphanPayoutLines":0,"orphanRefundLines":0,"ambiguousActiveKeys":0}

## By year (corrections)

| year | false_refund | result_kind | special_addition |
|---|---:|---:|---:|
| 2000 | 966 | 0 | 640 |
| 2004 | 24920 | 0 | 5345 |
| 2005 | 42510 | 0 | 9083 |
| 2006 | 43222 | 0 | 9127 |
| 2007 | 36345 | 0 | 7513 |
| 2008 | 30764 | 0 | 6379 |
| 2009 | 28875 | 0 | 5954 |
| 2010 | 26541 | 0 | 5348 |
| 2011 | 21151 | 0 | 4098 |
| 2012 | 18326 | 0 | 3486 |
| 2013 | 15715 | 0 | 2988 |
| 2014 | 10620 | 0 | 1985 |
| 2015 | 6964 | 0 | 1284 |
| 2016 | 4470 | 0 | 808 |
| 2017 | 2286 | 0 | 413 |
| 2018 | 1316 | 0 | 232 |
| 2019 | 1070 | 0 | 181 |
| 2020 | 443 | 0 | 76 |
| 2021 | 326 | 0 | 55 |
| 2022 | 206 | 0 | 36 |
| 2023 | 233 | 0 | 39 |
| 2024 | 228 | 0 | 42 |
| 2025 | 144 | 0 | 26 |
| 2026 | 106 | 0 | 18 |

## By bet type (corrections)

| bet_type | false_refund | result_kind | special_addition |
|---|---:|---:|---:|
| exacta | 58170 | 0 | 4 |
| place | 28412 | 0 | 23154 |
| quinella | 58080 | 0 | 54 |
| trifecta | 57836 | 0 | 0 |
| trio | 57829 | 0 | 12 |
| wide | 57418 | 0 | 103 |
| win | 2 | 0 | 41829 |

> append-only: 既存 row を UPDATE/DELETE しない。source sidecar への write は 0。production apply は BLOCKED。
