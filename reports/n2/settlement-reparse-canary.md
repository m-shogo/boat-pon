# Settlement reparse (temp-copy, canary)

- generated: 2026-08-03T06:36:26.191Z
- mode: simulated (production apply BLOCKED)
- as-of: 2026-08-01T00:00:00.000Z
- source: /Users/m-shogo/Developer/personal/boat-pon/data/research-replay.sqlite
- source sha256: d9b5ddd264ea138f319b04a8fb9398f1048bb2ad3001055ffe319616d6b6cb92
- target: /Users/m-shogo/Developer/personal/boat-pon/data/tmp/reparse-canary.sqlite
- target final sha256: 9bad219cbc6debaad75c4ef5b328fb4ffdb2adcea814949049225dd35567dd22
- defect: V1_SPECIAL_PAYOUT_FALSE_REFUND
- source parser: n1-settlement-parser-v1 → target parser: n1-settlement-parser-v2
- output digest: 2902a5a1fa27a6affeee71c91c3046a22c25d34780099af11290c75a68952319
- result: REPARSED

## Actions

| action | count |
|---|---:|
| exact | 42821 |
| false_refund_correction | 1730 |
| result_kind_correction | 0 |
| special_payout_addition | 360 |
| ambiguous_non_defect | 0 |
| unexpected_addition | 0 |

## Appends (append-only)

- appended candidates 2090 / supersession relations 1730 / parse_runs 45 / observations 319

## Files

- scanned 46 / ingested 45 / not_ingested(backfill gap) 1 / duplicate_source 0 / parse_errors 0

## Active candidate counts (logical)

| status | before | after (delta) | after (measured) |
|---|---:|---:|---:|
| settled | 7833297 | 7835387 | — |
| refunded | 319301 | 317571 | — |
| partially_refunded | 1 | 1 | — |
| **logical total** | 8152599 | 8152959 | |

- after delta == measured: null
- physical settlement_candidates_v2 rows: before 8156795 → after 8158885
- ambiguous active keys: 0

## Second run (idempotency)

- appended 0 (expect 0) / supersessions 0 (expect 0)

## Integrity

- light: {"multipleActiveSuccessors":0,"selfSupersedingCycles":0,"danglingSupersedes":0}
- append-only enforcement: {"updateBlocked":true,"deleteBlocked":true}
- full: not run (pass --verify)

## By year (corrections)

| year | false_refund | result_kind | special_addition |
|---|---:|---:|---:|
| 2000 | 3 | 0 | 2 |
| 2004 | 29 | 0 | 5 |
| 2005 | 212 | 0 | 46 |
| 2006 | 173 | 0 | 35 |
| 2007 | 205 | 0 | 43 |
| 2008 | 418 | 0 | 87 |
| 2009 | 211 | 0 | 44 |
| 2010 | 77 | 0 | 18 |
| 2011 | 141 | 0 | 30 |
| 2012 | 67 | 0 | 15 |
| 2013 | 84 | 0 | 16 |
| 2014 | 23 | 0 | 4 |
| 2015 | 28 | 0 | 5 |
| 2016 | 35 | 0 | 6 |
| 2017 | 12 | 0 | 2 |
| 2018 | 6 | 0 | 1 |
| 2019 | 6 | 0 | 1 |

## By bet type (corrections)

| bet_type | false_refund | result_kind | special_addition |
|---|---:|---:|---:|
| exacta | 317 | 0 | 0 |
| place | 147 | 0 | 134 |
| quinella | 317 | 0 | 0 |
| trifecta | 317 | 0 | 0 |
| trio | 317 | 0 | 0 |
| wide | 315 | 0 | 2 |
| win | 0 | 0 | 224 |

> append-only: 既存 row を UPDATE/DELETE しない。source sidecar への write は 0。production apply は BLOCKED。
