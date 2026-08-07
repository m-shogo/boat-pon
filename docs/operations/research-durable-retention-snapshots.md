# Research Durable Retention Snapshots

Status: one-shot retention evidence operation  
Scope: sanitized automation-history retention metadata only  
Production authority: none

## Why this exists

The durable-knowledge completeness audit proved against the real `automation/boat-pon-research` branch that all 15 persisted research histories remain durable. A transient Actions log is not itself durable project knowledge, so a successful audit can now materialize a small append-only retention snapshot on the automation state branch.

The snapshot is an operational evidence artifact. It does not evaluate ROI, strategy quality, BUY eligibility, or promotion readiness.

## No second scheduler

Research execution already uses ChatGPT Scheduled Task / explicit dispatch as the scheduler and intentionally does not use GitHub `on.schedule` for the local research loop.

The retention workflow follows the same rule:

```text
.github/workflows/research-durable-retention-snapshot.yml
```

is `workflow_dispatch` only. It never redispatches itself and contains no recurrence. The existing scheduler/manual operator may dispatch one retention check when desired.

## Source and write boundaries

The workflow:

1. checks out `main` as the audit-code authority;
2. fetches `automation/boat-pon-research` into a detached worktree;
3. audits only persisted research histories and their approved durable outputs;
4. may write exactly one artifact under:

```text
reports/automation/retention/durable-knowledge/YYYY-MM-DD/<evidenceDigest>.json
```

5. CAS-checks the automation branch before committing;
6. pushes without force and never auto-retries a conflict.

It does not modify `reports/automation/history`, N2 reports, registries, queue/control state, raw/private data, databases, Current BUY, LINE, public output, or production settings.

The retention path is already inside `scripts/automation-commit.sh`'s broad `reports/automation/` allowlist, but this workflow applies a narrower path check and stages exactly one expected file.

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

When actual history or referenced durable evidence changes, the semantic digest changes and a new append-only snapshot is created.

## Existing artifact rule

If the semantic path already exists, the file must pass its own snapshot digest and protected-boundary validation. A valid existing snapshot is reused unchanged. A malformed or tampered existing snapshot is never overwritten; the operation fails closed.

`sourceStateShaAtFirstObservation`, `mainAuthorityShaAtFirstObservation`, and `firstObservedAt` record the first materialization lineage only. Later identical audits do not rewrite those fields.

## BLOCKED audits

If the completeness audit returns `BLOCKED`, the workflow may still append the sanitized retention snapshot so the negative finding itself is durable. After committing that evidence, the job exits non-zero to remain operationally visible.

A structural failure that prevents trustworthy snapshot construction (invalid path, malformed artifact, CAS conflict, parser failure, etc.) produces no state write.

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
