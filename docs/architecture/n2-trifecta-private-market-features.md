# N2 Private Trifecta Market Features

## Purpose

Convert accepted private BOAT RACE trifecta checkpoint captures into point-in-time market features suitable for offline research without moving raw odds into Git, public artifacts, Current BUY, LINE, or the operational databases.

## Input authority

Only an `accepted.json` checkpoint may enter the feature loader. For every accepted checkpoint the loader re-verifies:

- expected date / venue / race / checkpoint identity;
- accepted marker version and protected-boundary flags;
- raw and envelope paths stay inside the expected private checkpoint directory;
- no symlink is followed;
- raw size is bounded to 2 MB;
- raw SHA-256 matches the accepted marker;
- envelope is `PASS`, has zero blockers, 120 parsed selections and zero unavailable selections;
- envelope raw digest and paths match the accepted marker;
- snapshot audit is `PASS`;
- displayed source availability time exists;
- database / Current BUY / LINE / public / production boundaries remain disabled.

The raw HTML is then re-parsed privately. The loader performs no network request and no database read or write.

## Snapshot features

The exact 120-selection universe is validated before feature construction. Raw trifecta odds are transformed into a normalized inverse-odds market mass distribution. Each checkpoint produces:

- per-selection odds, rank and normalized market-mass share;
- inverse-odds mass total;
- Shannon entropy and normalized entropy;
- effective selection count;
- Herfindahl concentration;
- favorite / second-favorite odds and favorite gap ratio;
- top-1 / top-3 / top-5 / top-10 market-mass concentration;
- odds p10 / median / p90 and p90:p10 spread.

These are market-observation features, not calibrated probabilities. The normalization intentionally removes the common scale of the inverse-odds vector so that market concentration and relative repricing can be compared across checkpoints.

## Transition features

Chronological checkpoint pairs produce:

- Jensen-Shannon divergence in bits;
- total-variation distance;
- favorite change;
- top-5 retention and churn;
- median / maximum / mass-weighted absolute log-odds move;
- shortening / lengthening / unchanged selection counts;
- per-selection rank improvement, log-odds ratio and market-mass delta.

Missing checkpoints are preserved explicitly. For example T-30 -> T-10 is represented as a two-step transition rather than being mislabeled as adjacent.

## Sequence status

- `PASS`: T-30, T-20, T-10 and T-5 are all available and valid.
- `PARTIAL`: at least one valid checkpoint exists, but one or more are missing.
- `NO_DATA`: no accepted checkpoint exists.
- `BLOCKED`: identity, integrity, PIT lineage or protected-boundary validation fails.

Partial data is retained for research but is never silently imputed as a complete trajectory.

## Derived artifact lifecycle

Raw HTML, envelopes and accepted markers remain immutable source evidence. The private market-feature JSON is different: it is a deterministic **derived artifact** whose source trajectory can legitimately grow from T-30 to T-20 to T-10 to T-5 during the day.

Therefore a feature artifact is intentionally refreshable when its validated `sourceLoadDigest` changes. Refresh uses a same-directory temporary file, mode 0600, `fsync`, atomic rename and final mode verification. Existing symlink or non-regular targets are rejected.

Current artifact version:

```text
n2-trifecta-private-market-feature-artifact-v2
```

The artifact records:

- generation time;
- exact source-load digest;
- race identity and PASS/PARTIAL status;
- full private feature sequence;
- fixed private-only / no-public / no-DB / no-BUY / no-LINE / no-automated-betting boundaries;
- artifact digest.

If the source-load digest is unchanged, the writer is idempotent and leaves the existing artifact untouched. Legacy v1 artifacts or earlier PARTIAL artifacts may be atomically replaced by a later validated source digest. `NO_DATA` and `BLOCKED` reports are never written as feature artifacts.

This replaceability does not weaken source evidence: accepted markers and raw capture evidence remain the immutable authority from which the derived artifact can always be rebuilt.

## Storage and publication boundary

The default per-race CLI prints only a sanitized summary: checkpoint availability, counts, status and digests. It never prints raw odds or the 120-selection feature vectors.

Full feature artifacts require explicit `--write-private` and are exclusively created mode 0600 under:

```text
data/private/trifecta-market-features/<date>/<venue>/<race>.json
```

No feature artifact is committed or uploaded. This layer has no Current BUY, LINE, public, automated-betting, primary DB, sidecar DB, or production-apply authority.

Per-race usage:

```bash
npx tsx scripts/build-n2-trifecta-private-market-features.ts \
  --date 2026-08-07 \
  --venue 10 \
  --race 4
```

Add `--write-private` only when the private derived artifact should be created or refreshed.

## One-venue day batch

For the authorized one-venue review stage, all races 1 through 12 can be evaluated in one bounded local pass:

```bash
npx tsx scripts/build-n2-trifecta-private-market-feature-day.ts \
  --date 2026-08-07 \
  --venue 10
```

The default batch is read-only apart from the loader's private raw reads and prints only sanitized per-race metadata. With explicit `--write-private`, PASS/PARTIAL races create or refresh their private derived artifacts; NO_DATA races create nothing.

Batch status is fail closed:

- any race `BLOCKED` -> batch `BLOCKED`;
- all 12 races `PASS` -> batch `PASS`;
- no available race data -> batch `NO_DATA`;
- otherwise -> batch `PARTIAL`.

The batch performs no network request or database read/write and never prints or publishes raw odds values or full feature vectors.

## Research use

The immediate research target is to test whether market repricing contributes incremental information beyond existing racer / course / environment features. Candidate analyses include:

- whether sharp late shortening is predictive after controlling for existing estimated hit rate;
- whether high or low entropy regimes alter calibration / ROI;
- whether disagreement between model rank and market rank contains residual edge;
- whether large checkpoint divergence indicates information arrival, noisy markets, or unstable races;
- whether useful signals survive strict point-in-time and held-out evaluation.

No feature should enter Current BUY until offline evidence, PIT validation, holdout governance and explicit production promotion are separately satisfied.
