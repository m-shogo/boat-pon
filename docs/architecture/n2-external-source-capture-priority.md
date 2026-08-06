# N2 External Source Capture Priority

Status: contract-only; no network acquisition or DB write is authorized  
Safety: L0  
Applies after: TASK-N2-011 PASS and trifecta-market read-only foundation merge

## Decision

The next data work is ordered as follows:

1. BOAT RACE official trifecta odds HTML;
2. BOAT RACE official before-information HTML;
3. Japan Meteorological Agency historical station CSV for retrospective validation.

A generic weather API is not the first dependency. The immediate TASK-N2-020 blocker is the absence of raw, time-stamped, fully lineaged 120-selection trifecta market checkpoints.

## P0 — official trifecta odds

Source identity:

```text
https://www.boatrace.jp/owpc/pc/race/odds3t?hd=YYYYMMDD&jcd=CC&rno=R
```

Required evidence per checkpoint:

- canonical race ID;
- exact official URL;
- page-displayed odds update time;
- raw response bytes and SHA-256;
- fetch time;
- availability time;
- decision cutoff;
- checkpoint label;
- parser version;
- exactly 120 distinct ordered trifecta selections;
- positive finite odds for every selection;
- raw document, parse run, and proposed observation identities.

Atomic PIT requirement:

```text
availableAt <= fetchedAt <= decisionCutoff
```

The displayed update time cannot be replaced by filesystem modification time, database import time, race-result time, or a later page fetch.

## P1 — official before-information

Source identity:

```text
https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=YYYYMMDD&jcd=CC&rno=R
```

Candidate fields include:

- exhibition time;
- exhibition start timing and exhibition course;
- tilt;
- parts changes;
- weather;
- air temperature;
- water temperature;
- wind direction and speed;
- wave height.

The race-specific official water-surface observation has higher source priority than a distant general weather station for the same decision checkpoint.

When a trustworthy source-displayed update time is absent, the record is not assigned a synthetic publication time. A monotonic first-seen capture ledger is required, and the first-seen value must still precede the decision cutoff.

## P2 — JMA historical station CSV

The Japan Meteorological Agency historical download service is a supplementary retrospective source, not a same-day decision feed.

Required retained metadata:

- station ID and station coordinates;
- observation time;
- selected meteorological elements;
- quality and missing-data flags;
- homogeneity / station-change flags;
- download time;
- source attribution;
- raw CSV bytes and SHA-256;
- revision-check time.

Historical JMA values may be revised after quality control. A later revision must create a new immutable source version rather than silently replacing the earlier research snapshot.

Requests must be bounded and scheduled conservatively. The service warns against excessive automated access and limits the amount of data per request.

## Terms and acquisition boundary

The BOAT RACE official website exposes the necessary page structures, but this repository does not interpret public visibility as permission for unrestricted automated reuse.

Before any production network capture:

1. record an explicit terms/legal review result;
2. define a bounded source-specific canary;
3. fix URL, race range, checkpoint count, request rate, retention, and raw-byte handling;
4. create a human-readable review bundle;
5. obtain a new source-specific approval;
6. keep production capture and production writes disabled by default;
7. revoke the temporary approval after the bounded canary;
8. verify raw, parse, observation, and PIT lineage read-only.

No prior official-program approval may be reused.

## Explicit non-goals

This contract does not:

- perform an HTTP request;
- scrape or download official pages;
- write primary or sidecar databases;
- create an approval;
- enable global shadow writes;
- run TASK-N2-020;
- connect data to Current BUY, model selection, LINE, or public output;
- treat JMA historical data as live race information.

## Implementation authority

Machine-readable definitions and gates are in:

- `src/research-replay/n2ExternalSourceCaptureContract.ts`
- `src/research-replay/n2ExternalSourceCaptureContract.test.ts`

The current global verdict is:

```text
CONTRACT_ONLY_NOT_AUTHORIZED
```

Expected blockers remain:

- BOAT RACE terms review not completed;
- bounded source-specific approval missing;
- raw capture executor not implemented;
- production writer not authorized.
