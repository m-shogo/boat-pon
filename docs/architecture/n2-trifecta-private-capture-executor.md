# N2 Trifecta Private Capture Executor

Status: executor implementation; no real BOAT RACE request executed by this change  
Source: official trifecta odds HTML  
Storage: append-only local private raw evidence  
Database: no primary or sidecar write

## Purpose

The odds checkpoint policy defines which market states are worth retaining. This executor turns an exact reviewed plan into a fail-closed, one-attempt private capture path.

It is deliberately separate from the existing live BUY collector. It cannot update decision history, Current BUY, LINE, primary tables, sidecar observations or public dashboard output.

## Inputs

Execution requires all of the following:

1. a `READY_FOR_PRIVATE_REVIEW` checkpoint plan;
2. an exact source-specific approval;
3. matching stage, manifest digest and request budget;
4. valid issue and expiry times;
5. private-research-only declaration;
6. database, Current BUY, LINE and public redistribution flags fixed to false;
7. explicit `--execute` on the CLI.

Without `--execute`, the CLI is dry-run only. `--execute` without an approval fails before network access.

## Plan generation

The immutable plan reader opens the primary SQLite database using:

```text
immutable=1
readOnly=true
PRAGMA query_only=ON
```

It stops when an active primary WAL exists. It reads only `official_programs`, resolves one exact date and venue code, validates label-form and code-form race identities, and builds:

```text
12 races maximum × T-30/T-20/T-10/T-5 = 48 requests maximum
```

DB byte size and modification time must be unchanged before and after planning.

Planner CLI:

```bash
npx tsx scripts/plan-n2-trifecta-private-capture.ts \
  --db /absolute/path/to/boat.sqlite \
  --date YYYY-MM-DD \
  --venue 05 \
  --output /private/path/plan-review.json
```

The output file is exclusive-create. The planner creates no approval and performs no network request.

## Execution semantics

Capture CLI:

```bash
# Dry-run; no network
npx tsx scripts/run-n2-trifecta-private-capture.ts \
  --plan /private/path/plan.json \
  --root /private/boat-pon-data

# Explicit approved execution
npx tsx scripts/run-n2-trifecta-private-capture.ts \
  --execute \
  --plan /private/path/plan.json \
  --approval /private/path/approval.json \
  --root /private/boat-pon-data \
  --report /private/path/run-report.json
```

JSON inputs must be regular non-symlink files and no larger than 2 MB. Optional report output uses exclusive-create.

## Request safety

- HTTPS official allowlisted URL comes from the reviewed plan;
- GET only;
- redirects rejected;
- 15-second timeout;
- raw response capped at 2 MB while streaming;
- concurrency 1;
- minimum 10 seconds between requests;
- one request attempt per checkpoint;
- no immediate retry;
- stop after the first fetch, content, parser, timing or PIT failure;
- approval request budget is a hard ceiling.

A lease file prevents concurrent execution of the same manifest.

## Crash-safe one-attempt rule

Before the HTTP request, the executor appends `ATTEMPT_STARTED` to an immutable JSONL ledger. A later process treats that checkpoint as already attempted even if the prior process crashed before completion.

This intentionally prefers missing one checkpoint over repeated uncontrolled requests.

After the request it appends `ATTEMPT_COMPLETED` with PASS, BLOCKED or FETCH_ERROR. The ledger is never rewritten.

## Evidence and identity

Every response is evaluated for:

- HTTP 200;
- HTML content type;
- response size;
- checkpoint target window;
- pre-decision timing;
- page-displayed odds update time;
- `availableAt <= fetchedAt <= decisionCutoff`;
- exactly 120 parsed selections;
- no unresolved unavailable selections;
- raw SHA-256;
- raw document identity;
- parse-run identity;
- proposed observation identity;
- full trifecta snapshot audit.

Only a complete PASS creates `accepted.json` for the checkpoint. Blocked responses retain raw bytes and an envelope for diagnosis but do not become accepted market evidence.

Raw path:

```text
data/raw/research/trifecta-market/YYYY-MM-DD/VV/RR/T-N/<fetchedAt>-<sha256>.html
```

Envelope path uses the same identity with `.envelope.json`. Files are mode `0600` and exclusive-create. Existing evidence is never overwritten.

## Non-interference

Every run report fixes these values:

```text
databaseWriteCount: 0
primaryDbWriteCount: 0
sidecarWriteCount: 0
currentBuyChanged: false
lineChanged: false
publicPublished: false
automatedBettingChanged: false
productionApplyExecuted: false
```

Raw files remain ignored by Git and must not be placed in public artifacts.

## Implementation authority

- `src/research-replay/n2TrifectaPrivateCaptureExecutor.ts`
- `src/research-replay/n2TrifectaPrivateCaptureExecutor.test.ts`
- `src/research-replay/n2TrifectaPrivateCapturePlanReader.ts`
- `src/research-replay/n2TrifectaPrivateCapturePlanReader.test.ts`
- `scripts/plan-n2-trifecta-private-capture.ts`
- `scripts/run-n2-trifecta-private-capture.ts`
