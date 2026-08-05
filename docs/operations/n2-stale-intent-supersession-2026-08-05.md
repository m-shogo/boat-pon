# N2 stale intent supersession — 2026-08-05

## Problem

`TASK-N2-010` had two immutable intent files on `main`:

- `INTENT-20260805-k8m2q7v4pz` with `expectedAuthoritySha=56f0b47`;
- `INTENT-20260805-z7m4q2p8kx` with `expectedAuthoritySha=1184fa4`.

The authority before the replacement was:

```text
00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1
```

The intent guard and local runner only accept the current `main` SHA or its immediate parent. Both older authorities were therefore terminally stale and would fail with `AUTHORITY_SHA_MISMATCH` if retriggered.

The files must not be edited, deleted, reused or backfilled into `processed-intents.json`. At the same time, treating every unprocessed file as permanently active deadlocks the task because a valid replacement can never be created.

## Creation-time contract

A stale intent may be replaced only when all of the following are true at the replacement push:

1. the old intent has the same `taskId` and requested action as the replacement;
2. the old intent is absent from the processed-intent ledger;
3. its `expectedAuthoritySha` is outside the current push authority set;
4. a strict immutable supersession record identifies the old intent, its exact authority, the replacement intent and `AUTHORITY_SHA_MISMATCH`;
5. `observedAuthoritySha` matches the authority referenced by the replacement intent;
6. the replacement itself references the current push authority and passes all ordinary guard checks;
7. exactly one new intent file is added in the push.

An equivalent unprocessed intent whose authority is still current can never be superseded by this mechanism. It remains a hard duplicate block.

## Durable terminal semantics

A merged strict supersession does **not** expire when `main` advances.

Its ongoing validity is anchored to immutable Git evidence:

- the supersession record remains strict-schema valid;
- the named old intent still exists;
- the old intent ID and exact `expectedAuthoritySha` match the supersession entry;
- the named replacement intent still exists;
- old intent, replacement intent and supersession record have the same task;
- old and replacement requested actions match;
- `observedAuthoritySha` matches the replacement intent's `expectedAuthoritySha` by full/short SHA prefix.

Therefore, after the replacement is processed, the older files remain terminal stale rather than returning to the active-pending set. A later retry does not require the original observed authority to still be current.

The replacement itself is separate evidence. Until it is processed or itself receives a later strict supersession, it remains an active unprocessed intent and blocks another equivalent dispatch.

## Machine enforcement

- contract: `src/automation/intentSupersession.ts`
- tests: `src/automation/intentSupersession.test.ts`
- JSON Schema: `config/research-governance/research-intent-supersession.schema.json`
- push guard integration: `scripts/guard-intent-push.ts`
- immutable records: `automation/requests/supersessions/`

The guard scans all existing intents for the same task/action. Processed intents are ignored. Still-current unprocessed equivalents block unconditionally. Stale equivalents also block unless they have a durable immutable supersession binding. An unprocessed stale replacement remains a blocker and must not be skipped merely because it replaced something older.

## Current replacement

Supersession record:

```text
automation/requests/supersessions/SUPERSESSION-20260805-n2-010-r4n8v2k6qx.json
```

Replacement intent:

```text
automation/requests/intents/INTENT-20260805-r4n8v2k6qx.json
```

The replacement is still subject to actor allowlist, catalog/state validation, READY/dependency gates, queue digest generation, single-flight lock, read-only sidecar guards and all executor governance.

## Safety

This mechanism does not:

- mark an old intent PASS;
- add it to the processed ledger;
- change queue state directly;
- weaken replacement authority freshness;
- permit duplicate active intents;
- allow a still-current intent to be superseded;
- change Current BUY, LINE, `app_settings`, sidecar data, production or betting behavior.

It only provides an auditable and durable terminal classification for immutable intents that could no longer pass the authority guard at the time their replacement was created.
