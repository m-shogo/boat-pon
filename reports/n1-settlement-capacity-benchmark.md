# N1 settlement capacity benchmark

- benchmark: `n1-capacity-benchmark-v1`
- schema: `n1-settlement.0.1` / checksum `35903ee175dbb31cbc7202aa573a2e1b4f6d58d9b6954cfac4cee0fdfa4eb94d`
- external requests: 0 / primary writes: 0 / permanent sidecar writes: 0
- sample seed: `n1b-capacity-stratified-v1`

## Sample (stratified, deterministic)

- files: 75 / races: 11621 / venues: 24 / decades: 2000s, 2010s, 2020s
- schema families: {"legacy_pre_trifecta":7,"modern_seven_display":68}
- selection rule: sort(all k*.lzh); force-include first 6 of 2000s (legacy schema); from each of 2000s/2010s/2020s pick evenly-spaced files until per-bucket quota; deterministic index math, no RNG
- special cases observed: refunded 2873, partial 0, multi-line 21398, special-payout 0

## Measured

| metric | value |
|---|---:|
| candidates | 74673 |
| payout lines | 104404 |
| refund lines | 4397 |
| evidence pins | 224019 |
| DB bytes | 101982208 |
| WAL peak bytes | 4206552 |
| backup bytes | 99340288 |
| index overhead ratio | 0.303 |
| evidence pin share of DB | 0.331 |
| bytes/race | 8775.7 |
| bytes/candidate | 1365.7 |
| bytes/payout line | 976.8 |
| bytes/evidence pin | 455.2 |

## Timings (ms)

migration 3.1 / insert 11519.5 / replay 13.9 / backup 212.8 / restore 206.8

## Full-backfill projection (11621 → 8164 files / 1,194,007 races)

| projection | low | base | high |
|---|---:|---:|---:|
| full DB bytes | 8906492530 | 10478226506 | 13097783133 |
| raw store bytes | 1221568489 | 1437139399 | 1796424249 |
| backup bytes | 8675763649 | 10206780764 | 12758475955 |

- projected candidates: 7672325 / payout lines: 10727055 / evidence pins: 23016974
- projected DB base: **9.76 GiB** (low 8.29 GiB / high 12.20 GiB)
- projected temp free-space requirement: 20.86 GiB
- WAL amplification: 0.041 / backup amplification: 0.974

## Quota verdict

- current quota: 1.00 GiB / disk free: 392.55 GiB
- fits current quota: **NO**
- recommended quota: **15.95 GiB**
- recommended low-water: 31.90 GiB
- recommended backup retention: 3

> evidence pinがDBの約33%を占める。candidate毎に3行の重複pinを保存しており、
> full backfillで約23.0M行になる。candidate FKを暗黙pinとして扱うOption Bで削減余地がある。
