# N2 Trifecta Odds Private Checkpoint Capture

Status: implementation and review foundation; no network run or database write in this change  
Source: BOAT RACE official trifecta odds page  
Use: private research only  
Safety: no automatic betting, no Current BUY/LINE connection, no public redistribution

## Decision

Trifecta odds are essential research data. The project must retain market prices across all races rather than collecting only races that already became BUY candidates.

The canonical initial checkpoint set is:

```text
T-30 / T-20 / T-10 / T-5
```

Each page request returns the complete three-way ordered market and must be parsed as exactly 120 selections, including explicit unavailable/refund states where applicable.

This replaces blind five-minute polling as the default. The system preserves the important market path while avoiding repeated requests that do not correspond to a frozen analysis checkpoint.

## Why not continuous five-minute polling

A five-minute poll over a two-hour window requires 25 requests per race. For 72 races this is 1,800 requests per day.

The four canonical checkpoints require:

```text
72 races × 4 checkpoints = 288 requests per day
```

Both designs observe all 120 trifecta selections. The checkpoint design therefore preserves the research dimensions that matter while using roughly one sixth of the requests in this example.

The official site policy does not publish a numeric safe-request threshold. It prohibits bulk information transmission and access that interferes with site operation. Accordingly, this repository does not treat a five-minute interval as automatic permission.

## Staged rollout

### Stage 0 — raw-envelope review

- one venue-day;
- at most 12 races;
- T-10 only;
- at most 12 requests;
- concurrency 1;
- minimum 10 seconds between requests;
- one attempt only;
- no network execution until an exact source-specific approval exists.

### Stage 1 — one-venue checkpoint canary

- one venue-day;
- at most 12 races;
- T-30/T-20/T-10/T-5;
- at most 48 requests;
- concurrency 1;
- minimum 10 seconds between requests;
- no immediate retry;
- all raw documents append-only and private.

### Stage 2 — all-active-venues review

- at most 12 active venue-days;
- at most 144 races;
- T-30/T-20/T-10/T-5;
- at most 576 requests;
- requires successful Stage 1 evidence and a new digest-bound approval;
- does not inherit or reuse an official-program or observation-write approval.

The limits are ceilings, not targets. A daily plan must contain only races present in the reviewed official program inventory.

## Raw evidence contract

Every response must retain:

- exact official URL;
- race identity;
- checkpoint label;
- target capture time;
- actual fetched time;
- page-displayed odds update time;
- decision cutoff;
- HTTP status and allowlisted response headers;
- content type;
- raw byte length;
- SHA-256 of the exact raw bytes;
- parser version;
- parse-run identity;
- exactly 120 ordered selections or an explicit blocked result;
- raw-document, parse-run and proposed-observation lineage.

Raw files use an append-only identity path:

```text
data/raw/research/trifecta-market/YYYY-MM-DD/VV/RR/T-N/<fetchedAt>-<sha256>.html
```

An existing path must never be overwritten. Raw HTML must not be committed to Git, exposed by the public dashboard, or redistributed.

## Availability and PIT

The page-displayed odds update time is the source availability basis. File modification time, import time, request-start time and later database write time cannot replace it.

Every checkpoint must satisfy:

```text
availableAt <= fetchedAt <= decisionCutoff
```

Missing, ambiguous or post-cutoff times fail closed. A late response cannot be relabeled as the requested earlier checkpoint.

## Approval boundary

Network execution and local raw persistence require a temporary approval bound to:

- exact approval scope;
- stage;
- plan manifest digest;
- request budget;
- issue and expiry times;
- private-research-only use;
- public redistribution false;
- database write false;
- Current BUY connection false;
- LINE connection false.

Any plan or digest drift blocks execution. Approval cannot authorize database writes or production apply.

## Non-interference

This work does not change:

- Current BUY;
- selector/model parameters;
- decision history;
- LINE messages, state or retry behavior;
- `app_settings`;
- primary or sidecar schema/rows;
- holdout;
- global shadow-write state;
- Cloudflare/public deployment;
- automated purchase or voting.

Implementation authority:

- `src/research-replay/n2TrifectaRawCaptureCanary.ts`
- `src/research-replay/n2TrifectaRawCaptureCanary.test.ts`
- `src/research-replay/n2TrifectaOddsCheckpointCollection.ts`
- `src/research-replay/n2TrifectaOddsCheckpointCollection.test.ts`
