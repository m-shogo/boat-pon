# Research Durable Retention Snapshots

Status: one-shot retention evidence operation + bounded end-of-day hook  
Scope: sanitized automation-history retention metadata only  
Production authority: none

## Why this exists

The durable-knowledge completeness audit proved against the real `automation/boat-pon-research` branch that all 15 persisted research histories remain durable. A transient Actions log is not itself durable project knowledge, so a successful audit can now materialize a small append-only retention snapshot on the automation state branch.

The snapshot is an operational evidence artifact. It does not evaluate ROI, strategy quality, BUY eligibility, or promotion readiness.

## No second scheduler

Research execution already uses ChatGPT Scheduled Task / explicit dispatch as the scheduler and intentionally does not use GitHub `on.schedule` for the local research loop.

The standalone retention workflow:

```text
.github/workflows/research-durable-retention-snapshot.yml
```

is `workflow_dispatch` only. It never redispatches itself and contains no recurrence.

The existing one-shot research workflow also contains an end-of-day retention hook. This does **not** add another scheduler: after each existing dispatch completes, an Ubuntu-hosted follow-up checks the current JST hour. Outside `23` it exits after the time gate. During JST 23:00-23:59 it performs the same bounded retention materialization. Therefore the existing hourly ChatGPT dispatch remains the only recurring trigger and no additional ChatGPT schedule slot is required.

Repeated/manual dispatches within the 23-hour window are safe because same-day identical semantic evidence resolves to the same verified snapshot path and produces `changed=false`.

## Source and write boundaries

The retention operation:

1. checks out `main` as the audit-code authority;
2. fetches `automation/boat-pon-research` into a detached worktree;
3. audits only persisted research histories and their approved durable outputs;
4. may write exactly one artifact under:

```text
reports/automation/retention/durable-knowledge/YYYY-MM-DD/<evidenceDigest>.json
```

5. verifies that no other worktree path changed;
6. CAS-checks the automation branch before committing;
7. pushes without force and never auto-retries a conflict.

It does not modify `reports/automation/history`, N2 reports, registries, queue/control state, raw/private data, databases, Current BUY, LINE, public output, or production settings.

The end-of-day hook runs on `ubuntu-latest`, not the self-hosted Mac, and contains no access to local raw/private market evidence or the primary/sidecar DB.

The retention path is already inside `scripts/automation-commit.sh`'s broad `reports/automation/` allowlist, but the retention operation applies a narrower path check and stages exactly one expected file.

## Semantic identity and recursion avoidance

A snapshot is keyed by a semantic evidence digest over:

- persisted history content digests;
- run classifications and durable/strong flags;
- referenced output content/integrity digests;
- aggregate classifications and protected-boundary flags;
- the retention policy version.

The digest deliberately excludes:

- audit observation time;
- top-level audit output digest (which includes observation time);
- automation branch SHA;
- main commit SHA.

This prevents self-reference:

```text
retention snapshot commit
  -> automation branch SHA changes
  -> next audit sees identical research evidence
  -> same evidence digest/path
  -> existing verified snapshot reused
  -> no new commit
```

When actual history or referenced durable evidence changes, the semantic digest changes and a new append-only snapshot is created. Within a day this can produce more than one snapshot only when the underlying durable evidence actually changed and the retention operation was invoked again; unchanged evidence does not churn.

## Existing artifact rule

If the semantic path already exists, the file must pass its own snapshot digest and protected-boundary validation. A valid existing snapshot is reused unchanged. A malformed or tampered existing snapshot is never overwritten; the operation fails closed.

`sourceStateShaAtFirstObservation`, `mainAuthorityShaAtFirstObservation`, and `firstObservedAt` record the first materialization lineage only. Later identical audits do not rewrite those fields.

## BLOCKED audits

If the completeness audit returns `BLOCKED`, the operation may still append the sanitized retention snapshot so the negative finding itself is durable. After committing that evidence, the job exits non-zero to remain operationally visible.

A structural failure that prevents trustworthy snapshot construction (invalid path, malformed artifact, CAS conflict, parser failure, etc.) produces no state write.

## End-of-day failure semantics

The hook runs after the existing one-shot research task with `always()` semantics because a failed/BLOCKED research attempt can still have valid durable history committed by the existing `if: always()` automation commit step. The retention audit always evaluates the **actual state branch contents**, never the in-memory task result.

If the task's state commit did not reach `automation/boat-pon-research`, the retention hook cannot invent it: it snapshots only what is durably present. A CAS conflict is visible and never retried or force-pushed.

## Protected boundaries

Every snapshot fixes all of these to `false`:

- `automaticPromotionAuthorized`
- `currentBuyConnectionAuthorized`
- `lineConnectionAuthorized`
- `publicPublishAuthorized`
- `databaseWriteAuthorized`
- `automatedBettingAuthorized`
- `productionApplyAuthorized`

The snapshot contains only counts, digests, classifications, and IDs/warnings for non-strong runs. It does not copy history summaries, raw market values, odds, private feature values, or model/BUY data.
