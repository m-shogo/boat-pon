# N2 Baseline Common-Cohort Evaluation

Status: foundation only; no executor registration
Tasks: `TASK-N2-020`, `TASK-N2-021`, `TASK-N2-022`
Safety: pure/read-only
Date: 2026-08-05

## Purpose

Create an exact comparison boundary for:

- market-only baseline;
- historical-only baseline;
- legacy comparison baseline.

The contract prevents a stronger-looking metric from being produced by comparing different races, selections, labels, cutoffs or periods.

## Row identity

Every baseline row is identified by:

```text
canonicalRaceKey | betType | betSelection | split
```

The row also requires:

- baseline ID and kind;
- decision cutoff;
- prediction availability time;
- probability in `[0,1]`;
- settled binary hit label;
- source-specific immutable provenance.

Refund, void, special-payout and unresolved targets are excluded upstream by the N2 target contract. They are not silently converted to losses.

## Time split

The split is derived from the canonical race date and cannot be caller-overridden:

```text
train          < 2022-01-01
validation     2022-01-01 .. < 2024-01-01
test           2024-01-01 .. < 2026-01-01
forward_shadow >= 2026-01-01
```

Split is part of the comparison identity. A test row and a forward-shadow row cannot become the same common-cohort row.

## Market-only baseline

The first contract uses the transparent selection-level proxy:

```text
probability = min(1, 1 / observed_odds)
method = reciprocal_odds_raw
```

It is deliberately named `raw`, not an overround-corrected or calibrated probability. Market capture and availability must both be at or before decision cutoff, availability must not follow capture, and observation/raw provenance IDs are required.

This foundation does not infer missing selections, use closing odds as a feature or read post-race prices.

## Historical-only baseline

Historical rows must provide:

- historical model version;
- feature contract version;
- exclusive training boundary;
- SHA-256 training snapshot digest;
- prediction availability no later than the evaluated decision cutoff.

The training boundary must not reach beyond the evaluated race. This is a minimum anti-leakage contract, not a claim that a historical model has already been trained or validated.

## Legacy baseline

Legacy rows require an immutable decision snapshot identity and model version. They are comparison evidence only and do not become the current production authority.

## Metrics

The pure evaluator calculates:

- row and positive counts;
- observed positive rate;
- mean predicted probability;
- binary log loss;
- Brier score;
- fixed ten-bin calibration;
- expected calibration error;
- metrics by train/validation/test/forward-shadow split;
- deterministic row-set and output digests.

ROI, drawdown, bankroll and ticket selection are intentionally excluded. Those belong to later evaluation/governance stages and must use actual price/outcome contracts.

## Common cohort

`compareN2BaselinesOnCommonCohort`:

1. validates each baseline independently;
2. rejects duplicate identities and mixed baseline IDs/kinds;
3. intersects exact identities across all baselines;
4. verifies label and decision-cutoff equality on every common row;
5. reports input counts and rows excluded outside the intersection;
6. evaluates each baseline only on the exact common rows;
7. returns `INSUFFICIENT_COMMON_COHORT` below a declared minimum;
8. never chooses a winner or promotes a strategy.

Statuses:

- `COMPARABLE`: at least two valid baselines and sufficient exact overlap;
- `INSUFFICIENT_COMMON_COHORT`: valid overlap exists but is below the declared minimum;
- `CONFLICT`: duplicate, label, cutoff, provenance or map-identity conflict;
- `INVALID`: fewer than two baselines.

## Current integration boundary

Implementation:

- `src/research-replay/n2BaselineEvaluation.ts`
- `src/research-replay/n2BaselineEvaluation.test.ts`

This foundation does not:

- read local databases;
- train a historical model;
- create N2-020/021/022 artifacts;
- register an executor;
- change catalog or queue state;
- connect to Current BUY or LINE;
- publish results;
- promote a strategy.

Executor/readers must be added only after N2-010 and N2-011 have verified terminal evidence and the actual source rows can satisfy this contract.
