# N2 Trifecta Mac Host Keep-Awake

## Purpose

A private checkpoint can be missed even when the collector, daily plan and launchd agent are healthy if the Mac is asleep for the entire checkpoint window. The 2026-08-07 Mikuni 5R T-5 incident demonstrated this host-availability failure mode.

This feature provides an explicit, independently managed host keep-awake option. It does not change the private capture service, authorization, immutable runtime, request schedule or market-data policy.

## Default state

Keep-awake is **not enabled by installation of the collector** and is **not enabled by default**.

The configuration CLI requires exactly one explicit action:

```bash
npx tsx scripts/configure-n2-trifecta-host-keepawake.ts --enable
```

or:

```bash
npx tsx scripts/configure-n2-trifecta-host-keepawake.ts --disable
```

Preview without changing the Mac:

```bash
npx tsx scripts/configure-n2-trifecta-host-keepawake.ts --enable --print-only
```

Running without `--enable` or `--disable`, or supplying both, fails closed.

## Power boundary

The LaunchAgent executes only:

```text
/usr/bin/caffeinate -s
```

`-s` creates a system-sleep assertion only while the Mac is on AC power. The configuration deliberately does not use broader assertions.

The feature:

- prevents system sleep while AC power is present;
- does not prevent display sleep;
- does not prevent disk idle separately;
- does not simulate user activity;
- does not use `caffeinate -i`, `-d`, `-m` or `-u`;
- does not invoke `pmset`;
- does not require `sudo`;
- does not modify macOS persistent power-management settings.

On battery power the `-s` assertion does not guarantee the host remains awake. This is intentional: expanding to a battery-wide or persistent power policy requires a separate explicit decision.

## Installation boundary

A real enable/disable operation is accepted only from the configured canonical repository on macOS while the repository is on `main` with a clean worktree. `--print-only` remains portable for CI and review.

The keep-awake LaunchAgent is separate from the private capture LaunchAgent:

```text
com.boatpon.capture-host-keepawake
```

Disabling it removes only this keep-awake LaunchAgent. It does not uninstall or alter the private collector, authorization, runtime authority, daily plan, reservations, heartbeat history or raw evidence.

## Protected boundaries

Enabling or disabling keep-awake does not modify:

- Current BUY;
- selector/model parameters;
- decision history;
- LINE;
- primary or sidecar DB rows/schema;
- public/Cloudflare surfaces;
- automated betting;
- capture request budget or checkpoint timing.

The generated plist is audited to reject privileged power-management commands, credentials and widened `caffeinate` assertions before it can be installed.
