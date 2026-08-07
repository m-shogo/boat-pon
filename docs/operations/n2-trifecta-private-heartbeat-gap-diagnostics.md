# N2 Trifecta Private Heartbeat Gap Diagnostics

## Purpose

The private heartbeat history records every local collector invocation, including `NO_CHANGE`. A missing interval in that append-only timeline is therefore useful host/launchd evidence.

This diagnostic converts the heartbeat JSONL into bounded, sanitized availability evidence so a future checkpoint miss can be triaged without immediately inspecting macOS unified logs.

## Input boundary

The report reads only:

```text
data/private/trifecta-capture/heartbeats/YYYY-MM-DD.jsonl
data/private/trifecta-capture/plans/YYYY-MM-DD.json
```

The heartbeat is sanitized metadata. The daily plan contains schedule/checkpoint metadata. The report does **not** read raw odds HTML, envelope market payloads, the primary DB or sidecar DB and performs no network request.

## Gap rule

The collector is scheduled every 30 seconds. The initial diagnostic uses:

```text
expected heartbeat interval: 30 seconds
significant gap threshold: > 120 seconds
recent window: 60 minutes
```

For consecutive heartbeat records more than 120 seconds apart, the report records:

- previous heartbeat time;
- next heartbeat time, or `null` for a currently open gap;
- observed duration;
- whether the gap is currently open;
- every checkpoint target/+120-second late window that overlaps the observed gap;
- overlap duration for each affected checkpoint.

The gap is availability evidence, not proof by itself that macOS sleep was the cause. A gap can also result from launchd or process execution failure. It narrows the next investigation from "collector logic vs host availability" to the host/runtime execution layer.

## Status semantics

- `PASS`: heartbeat metadata is valid and no significant gap occurred in the recent window; no current significant gap exists.
- `DEGRADED`: a significant gap is currently open or ended within the recent 60-minute window.
- `BLOCKED`: heartbeat history is missing/malformed/unsafe or the diagnostic input itself is invalid.

Historical gaps remain in the daily evidence but stop degrading current status after the recent window expires.

The report exposes `historyCoverageStartsAt`. Checkpoints before that timestamp cannot be attributed using heartbeat history and must remain `unknown` rather than being guessed as host-sleep misses.

## Fail-closed metadata validation

Each heartbeat record must retain the private diagnostic boundary:

```text
databaseWriteCount: 0
primaryDbWriteCount: 0
sidecarWriteCount: 0
rawOddsValuesRecorded: false
currentBuyChanged: false
lineChanged: false
publicPublished: false
automatedBettingChanged: false
productionApplyExecuted: false
```

Widened or malformed heartbeat metadata blocks the report rather than being treated as healthy availability evidence.

## Usage

Current JST day:

```bash
npx tsx scripts/report-n2-trifecta-private-heartbeat-gaps.ts
```

Explicit date/time for deterministic review:

```bash
npx tsx scripts/report-n2-trifecta-private-heartbeat-gaps.ts \
  --date 2026-08-07 \
  --now 2026-08-07T03:00:00.000Z
```

The report is read-only and sanitized. It may be used in private operability audits without exposing raw market values.
