# N2 Trifecta Local Private Capture Service

Status: hardened implementation, installed and verified on the user's Mac through explicit canonical-repository operations  
Source: BOAT RACE official trifecta odds HTML  
Scope: private research, one venue per day  
Checkpoints: T-30 / T-20 / T-10 / T-5  
Checkpoint window: exact target through +120 seconds; no early capture  
Database writes: none

## Why this replaces temporary GitHub Actions canaries

PR #75 proved that exact-time capture cannot depend on a self-hosted GitHub Actions queue. The workflow and approvals were correct in principle, but the Mac runner did not accept the jobs before the checkpoint windows expired.

The replacement is a Mac `launchd` agent. It starts a short process every 30 seconds. Most ticks perform no HTTP request. A request occurs only when one selected race checkpoint is inside the authorized executor window.

The service is independent of:

- GitHub Actions queue latency;
- the self-hosted runner service;
- an open ChatGPT conversation;
- PR creation timing;
- CI completion timing.

The host itself still has to be awake. Host sleep is a separate operability concern; the optional keep-awake capability is documented in `docs/operations/n2-trifecta-mac-host-keepawake.md` and is not enabled by the collector by default.

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

The Mac LaunchAgent executes a detached, tracked-clean immutable runtime bound to the authorization and exact reviewed authority SHA. Moving the installed runtime to a new SHA requires explicit `--renew --authorize`.

## Current-day private plan cache

After a successful current-day official-program refresh and readiness validation, the canonical daily-program flow builds a private schedule artifact:

```text
data/private/trifecta-capture/plans/YYYY-MM-DD.json
```

An eligible plan contains exactly one complete venue, 12 races and 48 checkpoint entries. It is mode 0600, digest-protected and contains operational schedule metadata rather than raw odds.

A valid current-day plan is the preferred live path. It allows checkpoint selection without opening or stat-gating the primary SQLite database at the checkpoint instant. This removes an active SQLite WAL from the normal live-capture critical path without weakening the WAL safety boundary.

Cache handling is fail closed:

- valid current-day cache: use it without primary DB access;
- missing or explicitly stale cache: use the immutable/read-only/query-only DB fallback;
- DB fallback with an active WAL: block before network and try a later tick;
- malformed, tampered, symlinked, oversized or digest-invalid cache: block and do not fall back to DB.

See `docs/operations/n2-trifecta-private-daily-plan-cache.md` for the full cache contract.

## Crash-safe request budget

Before network execution, the service exclusively creates:

```text
data/private/trifecta-capture/reservations/YYYY-MM-DD/<reservation-key>.json
```

A reservation remains even if the process crashes. This deliberately prefers a missed snapshot over an uncontrolled repeat request.

The daily request budget is counted from reservation files. Once 48 reservations exist, no further request can run that day.

The underlying executor independently writes `ATTEMPT_STARTED` before HTTP and refuses a second attempt for the same single-entry manifest. The service therefore has two separate duplicate guards.

When multiple checkpoint windows overlap, due entries are considered in deterministic time/race order. Already-reserved earlier due entries are skipped and the first unreserved due entry may be reserved. The tick still creates at most one new reservation and performs at most one network request.

## Tick behavior

Each authorized tick:

1. validates the local authorization and immutable runtime authority;
2. computes the current JST date;
3. loads and validates the current-day private plan cache;
4. when the cache is valid, uses it directly without primary DB access;
5. when the cache is missing/stale, uses the immutable DB fallback and retains the active-WAL guard;
6. loads or creates the day's deterministic venue selection;
7. identifies entries from the exact checkpoint target through the +120-second late window;
8. scans due entries in order, skipping prior reservations;
9. selects and exclusively reserves at most one unreserved due checkpoint;
10. creates a one-entry plan and ephemeral approval;
11. invokes the existing private capture executor at most once;
12. stores append-only raw, envelope, accepted marker and private event evidence as applicable;
13. updates replaceable private operational status;
14. appends one sanitized private heartbeat record for the invocation.

There is no early capture allowance. A tick with no due checkpoint, or with only already-reserved due checkpoints, returns `NO_CHANGE` and performs zero network requests.

Heartbeat persistence is diagnostic-only. A heartbeat write failure is reported but does not trade away an otherwise authorized checkpoint capture.

## Local paths

All runtime material is under Git-ignored private or raw directories:

```text
data/private/trifecta-capture/authorization.json
data/private/trifecta-capture/runtime-authority.json
data/private/trifecta-capture/plans/
data/private/trifecta-capture/selections/
data/private/trifecta-capture/reservations/
data/private/trifecta-capture/reports/
data/private/trifecta-capture/status/latest.json
data/private/trifecta-capture/heartbeats/
data/private/trifecta-capture/logs/
data/raw/research/trifecta-market/
```

Files are created with private permissions where supported. Raw HTML is never uploaded as a GitHub artifact and is never committed.

## Installation and runtime authority

From the canonical Mac repository after `npm ci`:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts \
  --authorize \
  --days 30
```

The command:

- creates or reuses the private authorization;
- creates/verifies a detached immutable runtime for the exact authority SHA;
- writes the private runtime-authority binding;
- writes `~/Library/LaunchAgents/com.boatpon.trifecta-private-capture.plist`;
- loads the agent into the current GUI session;
- immediately starts one safe tick.

Existing authorization/runtime authority is not silently moved to a newer SHA. Renewal requires both flags:

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

Uninstall the collector agent while preserving authorization, runtime authority and evidence:

```bash
npx tsx scripts/install-n2-trifecta-local-capture-agent.ts --uninstall
```

Manual one-tick execution:

```bash
npx tsx scripts/run-n2-trifecta-local-capture-tick.ts
```

Host keep-awake is intentionally separate and explicit:

```bash
npx tsx scripts/configure-n2-trifecta-host-keepawake.ts --enable
npx tsx scripts/configure-n2-trifecta-host-keepawake.ts --disable
```

The collector installer does not implicitly enable it.

## Failure semantics

- expired/missing authorization: no network;
- invalid/mismatched immutable runtime authority: no network;
- valid private daily plan: normal path does not depend on primary DB/WAL state;
- missing/stale private plan + active primary WAL on fallback: no network, retry on a later tick;
- malformed/tampered private plan: fail closed, no DB fallback, no network;
- missing/invalid official programs on DB fallback: no network;
- no due checkpoint: `NO_CHANGE`;
- only prior-reserved due checkpoints: `NO_CHANGE`, no retry;
- overlapping due checkpoints with earlier reservations: first unreserved due may proceed, still maximum one request for the tick;
- daily reservation limit reached: `BLOCKED`;
- HTTP/parser/PIT failure: raw evidence retained, no accepted marker, no retry;
- invalid 120-selection snapshot: blocked evidence retained;
- database metadata drift on the fallback path: `BLOCKED`;
- heartbeat write failure: diagnostic error only; it does not cancel an otherwise authorized capture;
- Mac asleep for the entire checkpoint window: the checkpoint is missed and is not backfilled as an earlier market state.

## Operability evidence

The sanitized operability reporter reads private metadata only. It does not read raw odds values or envelope market payloads and performs no network or DB reads/writes.

It reports expected/matured checkpoints, accepted evidence, blocked evidence, reservations without accepted evidence, missed checkpoints, pending checkpoints, consecutive misses, authorization expiry, authority SHA, launchd registration, heartbeat age and private storage size.

The append-only heartbeat history allows later diagnosis to distinguish a running `NO_CHANGE` collector from a host/launchd gap where no tick occurred.

## Non-interference

Every capture report fixes:

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
- `src/research-replay/n2TrifectaReservedDueSelection.test.ts`
- `src/research-replay/n2TrifectaPrivateDailyPlanCache.ts`
- `src/research-replay/n2TrifectaPrivateDailyPlanIntegration.test.ts`
- `src/research-replay/n2TrifectaPrivateHeartbeat.ts`
- `src/research-replay/n2TrifectaPrivateCaptureOperability.ts`
- `src/research-replay/n2TrifectaLocalCaptureLaunchAgent.ts`
- `src/research-replay/n2TrifectaLocalCaptureLaunchAgent.test.ts`
- `scripts/run-n2-trifecta-local-capture-tick.ts`
- `scripts/install-n2-trifecta-local-capture-agent.ts`
- `scripts/report-n2-trifecta-private-capture-operability.ts`
- `src/automation/macCaptureHostKeepAwake.ts` (optional host operability; not collector authority)
- `scripts/configure-n2-trifecta-host-keepawake.ts` (explicit optional host operation)

## Hardening chronology

The service has accumulated several independent safety layers:

- installation is rejected unless it runs from the configured canonical repository path;
- non-preview installation requires the canonical repository to be on `main` with a clean working tree;
- launchd executes a detached, tracked-clean immutable runtime rather than the mutable canonical repo or an Actions `_work` checkout;
- runtime authority cannot silently move to a new SHA;
- current-day private plans remove the primary DB/WAL from the normal live checkpoint critical path while retaining fail-closed fallback behavior;
- exact checkpoint targets have zero early allowance and retain only the +120-second late window;
- `latest.json` is atomically replaced on every tick, while append-only event reports are written only when the operational event changes or an executor run occurs;
- append-only private heartbeat history records every invocation, including `NO_CHANGE`, without becoming a capture blocker;
- launchd output is quiet for unchanged events, preventing 30-second `NO_CHANGE` and repeated-blocker log amplification;
- concurrent daily-selection and checkpoint-reservation creation treats `EEXIST` as the intended duplicate guard;
- already-reserved earlier due entries cannot starve a later unreserved due checkpoint in the same tick;
- an empty current-day official-program inventory is a stable `NO_CHANGE`, not a crash loop;
- host sleep is represented as an operability dependency rather than silently backfilled market data;
- optional Mac keep-awake remains a separate explicit opt-in and does not alter persistent power settings.

Event reports are deduplicated by event digest:

```text
data/private/trifecta-capture/reports/YYYY-MM-DD/<event-digest>.json
```

A one-time GitHub self-hosted install/migration workflow must `cd` into the canonical repository, require a clean `main`, and update it to the reviewed main SHA before invoking the installer. Running the installer directly from an Actions `_work` checkout is intentionally rejected. Temporary operational workflows are closed without merge after sanitized verification evidence is recorded.
