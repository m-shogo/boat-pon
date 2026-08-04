# N2 dataset canary（corrected truth）

- generated: 2026-08-04T00:52:44.725Z / run: local-1785804764069 / request: REQ-run-localcanary5
- result: **PASS** / digest: 5799f38c4eb273632b204be0686190fbd1b80f57c7177f1b1f8c326b31ee91d4
- corrected truth: n2-corrected-settlement-truth-v1 / settlement identity: 353562988ef0d5a3f791fa19bfa3b1751fafcd9dd67738d1326895604f023730
- contracts: n2-dataset-contract-v1 / n2-target-contract-v2 / n2-feature-pit-contract-v2
- cohort: fixed-month cohort: 2024-06 (deterministic, no random sampling)

| 指標 | 値 |
|---|---:|
| races | 4662 |
| candidates | 32626 |
| corrected-truth candidates | 25 |
| eligible | 32622 |
| excluded | 4 |
| eligible rate | 99.99% |
| held-out excluded | 0 |
| source duplicate excluded | 0 |
| superseded excluded | 21 |

- exclusion reasons: {"excluded_refunded":4}
- by status: {"settled":32622,"refunded":4}
- by bet type: {"exacta":4662,"place":4662,"quinella":4662,"trifecta":4662,"trio":4658,"wide":4658,"win":4662}
- PIT: PASS / leakage: PASS
- time split: time-based, race-level group; canary is a single fixed month and is NOT a train/test split

> read-only canary。実 sidecar への write なし。held-out 2 件（win 返還欠落）は除外して数える。
