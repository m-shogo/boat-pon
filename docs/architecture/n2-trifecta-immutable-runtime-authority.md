# N2 Trifecta Immutable Runtime Authority

## Purpose

The private trifecta collector must not execute from mutable `main` or from a GitHub Actions `_work` checkout while a long-lived collection authorization remains active.

The existing local capture authorization continues to define collection scope:

- private research only;
- one venue per JST day;
- T-30 / T-20 / T-10 / T-5;
- maximum 48 reservations and requests per day;
- no database writes;
- no Current BUY connection;
- no LINE connection;
- no public publication;
- no automated betting.

A separate private runtime-authority binding now defines exactly which code may exercise that scope.

## Immutable release layout

Installation creates a detached Git worktree at:

```text
~/Library/Application Support/BoatPon/trifecta-private-capture/releases/<40-character-commit-sha>
```

The release directory must:

- resolve outside the mutable canonical repository;
- resolve outside every Actions runner `_work` directory;
- have an exact 40-character lowercase Git SHA;
- use detached HEAD;
- have no tracked-file changes;
- contain its own `npm ci` dependencies.

Untracked and ignored dependency files do not change authority. Tracked source drift does.

## Private authority files

The canonical private data root stores two mode-0600 files:

```text
data/private/trifecta-capture/authorization.json
data/private/trifecta-capture/runtime-authority.json
```

`runtime-authority.json` binds:

- the exact authorization ID;
- the exact authorization issue and expiry instants;
- the exact runtime commit SHA;
- the exact resolved runtime directory;
- all protected surfaces as unauthorized.

Changing the code authority requires an explicit installer invocation with both:

```text
--renew --authorize
```

A normal `main` update does not alter the active collector. Old immutable releases and raw evidence are preserved by default.

## Every-tick fail-closed guard

Before the existing capture service is called, the tick CLI verifies:

1. the runtime binding exists and is private JSON;
2. binding authorization identity and interval match `authorization.json`;
3. the binding is currently valid;
4. runtime `HEAD` exactly equals the bound SHA;
5. the runtime is detached;
6. tracked files are clean;
7. the current working directory equals the bound runtime root;
8. launchd-declared SHA and runtime root, when present, equal the binding.

Any failure stops before:

- official-program plan selection;
- reservation creation;
- network access;
- raw HTML persistence;
- database access through the capture service;
- BUY, LINE, public, betting, or production surfaces.

The failure is recorded privately through:

```text
data/private/trifecta-capture/status/runtime-authority-latest.json
data/private/trifecta-capture/reports/runtime-authority/<JST-date>/<event-digest>.json
```

Repeated identical failures replace only the latest status and do not create a new append-only event report every 30 seconds.

## Installation ordering

The installer completes these steps before replacing the active authorization or plist:

1. require the canonical clean `main` worktree;
2. resolve the exact authority SHA;
3. create or verify the detached immutable worktree;
4. run `npm ci` inside that worktree;
5. re-verify exact SHA, detached state, and tracked cleanliness;
6. build matching authorization and runtime binding;
7. write private authority files;
8. replace and bootstrap the LaunchAgent.

A failure before step 7 leaves the currently installed authority and LaunchAgent unchanged.

## Explicit exclusions

This mechanism does not:

- approve a new betting strategy;
- modify Current BUY conditions;
- modify LINE behavior;
- write primary or sidecar database rows;
- publish odds or raw HTML;
- clean up old releases automatically;
- upload private authority files;
- enable automated betting.
