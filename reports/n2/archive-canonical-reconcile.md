# Archive ↔ canonical settlement reconciliation

- generated: 2026-08-03T01:44:45.928Z
- scope: read-only reconciliation of v2-parsed K archive vs canonical active settlement candidates; no DB/archive/sidecar mutation
- as-of (archive cutoff): 2026-08-01T00:00:00.000Z
- settlement schema: n1-settlement.0.3
- parser: n1-settlement-parser-v2
- output digest: 3055b247e9e3a283836d13de5eda81d14163f6b198fd3cb49e5414ca8d542215
- result: RECONCILED

## Canonical DB (active)

- total candidates: 8156795
- active candidates: 8152599
- source-duplicate observations: 624
- superseded candidates: 0
- ambiguous active keys: 0

## Totals

| class | count |
|---|---:|
| exact_match | 7834852 |
| status_mismatch | 317747 |
| result_kind_mismatch | 0 |
| archive_only | 69440 |
| canonical_only | 0 |
| ambiguous_canonical | 0 |
| parse_failure (files) | 0 |
| — false_refund (subset of status_mismatch) | 317747 |

- archive-derived candidates: 8222039
- canonical reconciled candidates: 8152599
- exact-match rate: 0.9529086398155008
- archive covered by canonical: 0.9915544063948127
- canonical covered by archive: 1

## Status transition matrix (canonical → archive, status_mismatch)

| transition | count |
|---|---:|
| refunded->settled | 317747 |

## By year

| year | exact | status_mm | kind_mm | archive_only | canonical_only | false_refund |
|---|---:|---:|---:|---:|---:|---:|
| 2000 | 56156 | 966 | 0 | 640 | 0 | 966 |
| 2004 | 165917 | 24920 | 0 | 5345 | 0 | 24920 |
| 2005 | 289396 | 42510 | 0 | 9083 | 0 | 42510 |
| 2006 | 288683 | 43222 | 0 | 9127 | 0 | 43222 |
| 2007 | 305431 | 36345 | 0 | 7513 | 0 | 36345 |
| 2008 | 306376 | 30764 | 0 | 6379 | 0 | 30764 |
| 2009 | 321172 | 28875 | 0 | 5954 | 0 | 28875 |
| 2010 | 327300 | 26541 | 0 | 5348 | 0 | 26541 |
| 2011 | 329328 | 21151 | 0 | 4098 | 0 | 21151 |
| 2012 | 355961 | 18326 | 0 | 3486 | 0 | 18326 |
| 2013 | 356919 | 15715 | 0 | 2988 | 0 | 15715 |
| 2014 | 356103 | 10620 | 0 | 1987 | 0 | 10620 |
| 2015 | 360673 | 6964 | 0 | 1284 | 0 | 6964 |
| 2016 | 374975 | 4470 | 0 | 808 | 0 | 4470 |
| 2017 | 378788 | 2286 | 0 | 413 | 0 | 2286 |
| 2018 | 379795 | 1316 | 0 | 232 | 0 | 1316 |
| 2019 | 380277 | 1070 | 0 | 181 | 0 | 1070 |
| 2020 | 383385 | 443 | 0 | 76 | 0 | 443 |
| 2021 | 384014 | 326 | 0 | 55 | 0 | 326 |
| 2022 | 388588 | 206 | 0 | 36 | 0 | 206 |
| 2023 | 387220 | 233 | 0 | 39 | 0 | 233 |
| 2024 | 387056 | 228 | 0 | 42 | 0 | 228 |
| 2025 | 385777 | 144 | 0 | 26 | 0 | 144 |
| 2026 | 185562 | 106 | 0 | 4300 | 0 | 106 |

## By bet type

| bet_type | exact | status_mm | kind_mm | archive_only | canonical_only | false_refund |
|---|---:|---:|---:|---:|---:|---:|
| exacta | 1131858 | 58170 | 0 | 616 | 0 | 58170 |
| place | 1106127 | 28412 | 0 | 23766 | 0 | 28412 |
| quinella | 1123236 | 58080 | 0 | 666 | 0 | 58080 |
| trifecta | 1116706 | 57836 | 0 | 612 | 0 | 57836 |
| trio | 1115502 | 57829 | 0 | 623 | 0 | 57829 |
| wide | 1115134 | 57418 | 0 | 714 | 0 | 57418 |
| win | 1126289 | 2 | 0 | 42443 | 0 | 2 |

> reconciliation は v2 再parse（archive）と v1 由来 canonical DB を突合する。status_mismatch の大半は
> canonical=refunded → archive=settled（特払い bug 由来の偽返還）である。DB / archive / sidecar 無変更。
