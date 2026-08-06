# N2 Trifecta Local Private Capture Service

Status: hardened implementation and fixture validation; installation on the user's Mac remains an explicit canonical-repository action  
Source: BOAT RACE official trifecta odds HTML  
Scope: private research, one venue per day  
Checkpoints: T-30 / T-20 / T-10 / T-5  
Database writes: none

## Why this replaces temporary GitHub Actions canaries

PR #75 proved that exact-time capture cannot depend on a self-hosted GitHub Actions queue. The workflow and approvals were correct in principle, but the Mac runner did not accept the jobs before the checkpoint windows expired.

The replacement is a Mac `launchd` agent. It starts a short process every 30 seconds. Most ticks perform no HTTP request. A request occurs only when one selected race checkpoint is inside the existing executor window.

The service is independent of:

- GitHub Actions queue latency;
- the self-hosted runner service;
- an open ChatGPT conversation;
- PR creation timing;
- CI completion timing.

## Daily scope

The first operational stage remains deliberately bounded:

```text
one date
one automatically selected venue
maximum 12 races
T-30 / T-20 / T-10 / T-5
maximum 48 requests per day
one request per tick
```

The selected venue is written once to:

```text
data/private/trifecta-capture/selections/YYYY-MM-DD.json
```

Later program refreshes cannot silently switch the selected venue during the same day. Selection is deterministic: most valid races, then earliest first checkpoint, then venue code.

All-active-venues capture is not authorized by this service version.

## Authorization model

The installer creates a local authorization only when the operator supplies `--authorize`.

Authorization properties are fixed:

- maximum validity: 90 days;
- default validity: 30 days;
- stage: `ONE_VENUE_REVIEW`;
- daily request maximum: 48;
- checkpoints: T-30 / T-20 / T-10 / T-5;
- private research only;
- public redistribution false;
- database write false;
- Current BUY connection false;
- LINE connection false;
- automated betting false.

The long-lived authorization is not passed directly to the HTTP executor. Every due checkpoint receives a newly generated ephemeral approval bound to:

- exactly one checkpoint entry;
- exactly one plan digest;
- exactly one request;
- the checkpoint's late-window expiry;
- the original authorization expiry.

## Crash-safe request budget

Before network execution, the service exclusively creates:

```text
data/private/trifecta-capture/reservations/YYYY-MM-DD/<reservation-key>.json
```

A reservation remains even if the process crashes. This deliberately prefers a missed snapshot over an uncontrolled repeat request.

The daily request budget is counted from reservation files. Once 48 reservations exist, no further request can run that day.

The underlying executor independently writes `ATTEMPT_STARTED` before HTTP and refuses a second attempt for the same single-entry manifest. The service therefore has two separate duplicate guards.

## Tick behavior

Each tick:

1. validates the local authorization and expiry;
2. computes the current JST date;
3. verifies the primary SQLite file and blocks on an active WAL;
4. opens `official_programs` immutable, read-only and query-only;
5. builds valid one-venue plans;
6. loads or creates the day's venue selection;
7. identifies entries in the existing `-60s / +120s` checkpoint window;
8. selects at most one due entry;
9. reserves the checkpoint and daily budget before network access;
10. creates a one-entry plan and ephemeral approval;
11. invokes the existing private capture executor;
12. stores append-only raw, envelope, accepted marker and private report;
13. verifies primary DB metadata remains unchanged.

No due checkpoint returns `NO_CHANGE`. An already reserved checkpoint also returns `NO_CHANGE` and performs zero network requests.

## Local paths

All runtime material is under Git-ignored private or raw directories:

```text
data/private/trifecta-capture/authorization.json
data/private/trifecta-capture/selections/
data/private/trifecta-capture/reservations/
data/private/trifecta-capture/reports/
data/private/trifecta-capture/logs/
data/raw/research/trifecta-market/
```

Files are created with private permissions where supported. Raw HTML is never uploaded as a GitHub artifact and is never committed.

## Installation

From the canonical Mac repository after `npm ci`:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts \
  --authorize \
  --days 30
```

The command:

- creates or reuses the private authorization;
- writes `~/Library/LaunchAgents/com.boatpon.trifecta-private-capture.plist`;
- loads the agent into the current GUI session;
- immediately starts one safe tick.

Existing authorization is not silently extended. Renewal requires both flags:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts \
  --renew \
  --authorize \
  --days 30
```

Preview without writing or loading:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts \
  --authorize \
  --print-only
```

Uninstall the agent while preserving authorization and all evidence:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts --uninstall
```

Manual one-tick execution:

```bash
npx tsx scripts/run-n2-trifecta-local-capture-tick.ts
```

## Failure semantics

- expired/missing authorization: no network;
- active primary WAL: no network, retry on a later tick;
- missing/invalid official programs: no network;
- no due checkpoint: `NO_CHANGE`;
- prior reservation: `NO_CHANGE`, no retry;
- daily reservation limit reached: `BLOCKED`;
- HTTP/parser/PIT failure: raw evidence retained, no accepted marker, no retry;
- invalid 120-selection snapshot: blocked evidence retained;
- database metadata drift: `BLOCKED`;
- Mac asleep at a checkpoint: the checkpoint is missed and is not backfilled as an earlier market state.

## Non-interference

Every report fixes:

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

This service does not update Current BUY, selector/model parameters, decision history, LINE, `app_settings`, primary or sidecar rows, holdout, Cloudflare, public dashboard data or purchase behavior.

## Implementation authority

- `src/research-replay/n2TrifectaLocalCaptureService.ts`
- `src/research-replay/n2TrifectaLocalCaptureService.test.ts`
- `src/research-replay/n2TrifectaLocalCaptureLaunchAgent.ts`
- `src/research-replay/n2TrifectaLocalCaptureLaunchAgent.test.ts`
- `scripts/run-n2-trifecta-local-capture-tick.ts`
- `scripts/install-n2-trifecta-local-capture-agent.ts`


## v1.1 hardening

Before first installation, the service was hardened in four areas:

- installation is rejected unless it runs from the configured canonical repository path;
- non-preview installation requires the canonical repository to be on `main` with a clean working tree;
- `latest.json` is atomically replaced on every tick, while append-only event reports are created only when the operational event changes or an executor run occurs;
- launchd output is quiet for unchanged events, preventing 30-second `NO_CHANGE` and repeated blocker log amplification;
- concurrent daily-selection and checkpoint-reservation creation treats `EEXIST` as the intended duplicate guard;
- an empty current-day official-program inventory is a stable `NO_CHANGE`, not a crash loop.

The replaceable operational status is stored at:

```text
data/private/trifecta-capture/status/latest.json
```

Event reports are deduplicated by event digest:

```text
data/private/trifecta-capture/reports/YYYY-MM-DD/<event-digest>.json
```

A one-time GitHub self-hosted install workflow must `cd` into the canonical repository and update it to the reviewed main SHA before invoking the installer. Running the installer directly from an Actions `_work` checkout is intentionally rejected.
