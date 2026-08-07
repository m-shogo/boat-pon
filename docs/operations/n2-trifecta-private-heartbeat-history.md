# N2 Private Trifecta Heartbeat History

## Purpose

`status/latest.json` proves the most recent local collector state but overwrites prior `NO_CHANGE` ticks. That made a host-sleep gap indistinguishable from an uneventful collector period during the 2026-08-07 Mikuni 5R T-5 investigation.

The local tick launcher now appends one sanitized heartbeat record for every invocation, including `NO_CHANGE` and immutable-runtime `BLOCKED` ticks.

## Private format

Path:

`data/private/trifecta-capture/heartbeats/<JST-date>.jsonl`

Properties:

- append-only JSON Lines;
- owner-only mode 0600;
- private parent directory mode 0700;
- one record per local tick invocation;
- deterministic per-record digest;
- no raw HTML, odds, market snapshots or envelope payloads.

Each record contains only operational metadata such as time, status, blockers, authority SHA, selected venue/checkpoint identity, due count, network-request count and capture/block counts.

## Failure behavior

Heartbeat persistence is observability-only. A heartbeat write failure is reported as sanitized stderr metadata but does not cancel an otherwise-authorized odds capture. This avoids turning telemetry into a new checkpoint-loss source.

## Host-sleep interpretation

For a 30-second launchd interval, a multi-minute gap in heartbeat records while a checkpoint window passes is evidence that the local tick process was not being invoked successfully. Combined with macOS power logs, this can distinguish host sleep from WAL, authorization, parser, due-selection or network failures.

## Protected boundaries

Heartbeat history does not change:

- request cadence or request budget;
- immediate-retry policy;
- checkpoint early/late windows;
- primary DB or sidecar schema/writes;
- Current BUY, selector/model or decision history;
- LINE;
- public surfaces;
- automated betting;
- production apply.
