# Official Program Live Readiness

## Problem

The odds checkpoint collector requires a complete current-day official program inventory before it can build T-30 / T-20 / T-10 / T-5 plans.

The previous launchd job ran once at 08:00 JST. On 2026-08-07, the earliest official close time was 08:32 JST, so T-30 was 08:02. A job starting at 08:00 had only two minutes to inspect fourteen prior days, download, extract, parse, and import the current day. It was not a reliable live-data boundary.

The previous fetch behavior also had two stale-cache paths:

- `BOAT_PON_SKIP_EXISTING=1` skipped an entire date when any row already existed;
- an existing current-day LZH and extracted TXT were never refreshed.

A partial or early current-day artifact could therefore survive all later runs.

## New bounded schedule

`com.boatpon.daily-programs` runs at fixed JST checkpoints:

- 01:00
- 04:30
- 06:00
- 07:00
- 07:30

It also uses `RunAtLoad` for Mac restart recovery. It does not use a high-frequency `StartInterval` loop.

The final 07:30 checkpoint is 32 minutes before the observed 2026-08-07 earliest T-30 boundary. The source may fail at an early checkpoint; later checkpoints retry independently.

## Request budget

Each run:

- scans the previous fourteen days in SQLite;
- skips already imported historical dates;
- force-refreshes only the current JST date;
- performs at most one current-day archive request per attempt, with two bounded retries;
- uses a 15-second request timeout;
- rejects an archive larger than 20 MB.

The nominal schedule is at most five current-day archive refreshes per day, plus a possible `RunAtLoad` recovery execution.

## Atomic cache replacement

A forced current-day refresh:

1. downloads to a unique temporary path;
2. validates non-empty and bounded response bytes;
3. atomically renames the new LZH over the old cache only after success;
4. removes the extracted TXT only after the LZH replacement succeeds;
5. re-extracts and reparses the new archive.

A failed refresh preserves the previous cache but does not re-import it as a fresh observation.

## Structural gate

Before importing a date, every parsed venue must contain the canonical race-number set 1 through 12.

A structurally incomplete archive:

- is logged as incomplete;
- increments the failed-day count;
- is not partially imported;
- causes the fetch process to exit non-zero.

Imports for one date are wrapped in one SQLite transaction. A parser or write failure rolls back that date.

## Read-only readiness check

After the current-day import, `check-official-program-live-readiness.ts` opens the primary database with:

- `readOnly: true`;
- `PRAGMA query_only = ON`.

It verifies:

- at least one venue exists;
- every present venue contains races 1 through 12;
- a close time exists;
- the latest import is no more than 180 minutes old.

The report contains aggregate counts and incomplete venue/race-number diagnostics only. It performs zero database writes and does not expose odds, BUY decisions, or private raw data.

## Protected boundaries

This change does not modify:

- Current BUY conditions;
- selector or model parameters;
- decision history;
- LINE behavior;
- app settings;
- database schemas;
- sidecar data;
- holdout;
- public output;
- automated betting.

It only makes the existing official-program import path earlier, refreshable, atomic, and explicitly auditable.
