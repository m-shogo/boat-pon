# N2 Trifecta Odds Request Volume

This note records the request-volume rationale for the private checkpoint design.

## Fixed checkpoints

The canonical live market checkpoints are:

```text
T-30 / T-20 / T-10 / T-5
```

Each request obtains the full 120-selection trifecta page for one race.

For `R` races:

```text
fixed checkpoint requests = R × 4
```

Examples:

| Races | Fixed checkpoint requests |
|---:|---:|
| 12 | 48 |
| 72 | 288 |
| 144 | 576 |

## Blind five-minute polling

For a two-hour polling window, five-minute polling needs 25 requests per race, including both endpoints.

```text
blind polling requests = R × 25
```

Examples:

| Races | Blind five-minute requests |
|---:|---:|
| 12 | 300 |
| 72 | 1,800 |
| 144 | 3,600 |

The fixed-checkpoint design therefore keeps the market path needed for replay and ROI analysis while avoiding repeated non-checkpoint reads.

## Operational rule

- do not infer that a five-minute interval is automatically allowed;
- use concurrency 1;
- keep at least 10 seconds between requests;
- do not retry immediately;
- deduplicate exact race/checkpoint identities;
- retain the page-displayed odds update time;
- preserve immutable raw hash lineage;
- stop on HTTP errors, content drift, timing ambiguity or request-budget drift.

No request-volume calculation grants permission to publish, redistribute, commercialize or connect the captured content to public output.
