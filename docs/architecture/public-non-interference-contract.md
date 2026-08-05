# Public Non-Interference Contract

Status: authoritative product boundary
Date: 2026-08-05
Related: ADR-0005, ADR-0006

## Purpose

This contract turns the owner's concern — “could publishing the byproduct ever disturb my BUY?” — into explicit architecture, implementation and verification rules.

The target is stronger than privacy isolation. The public lane must be unable to affect authoritative output through data, control flow, timing, resources, failures, credentials, analytics or deployment.

## Priority order

1. Correct Current BUY decision
2. Timely and deduplicated LINE delivery
3. Authoritative local persistence and auditability
4. Optional owner drill-down
5. Public snapshot publication
6. SEO, analytics and advertising

A lower-priority item may be degraded, skipped or disabled to protect a higher-priority item. The opposite is prohibited.

## Trust zones

### Zone A — Authoritative local operation

Includes:

- Current BUY decision logic
- approved odds / program / feature inputs
- `app_settings`
- decision history
- notification eligibility
- LINE outbox and delivery
- settlement and result processing
- sidecar / archive / local runner state

Zone A may produce immutable outputs for lower zones. Lower zones may not call, mutate or configure Zone A.

### Zone B — Optional private presentation

Includes future Owner Web, optional owner history and manual record UI.

Zone B may display an authenticated private snapshot and submit narrowly scoped owner actions. It is not a prerequisite for generating or delivering a LINE message.

### Zone C — Public publication

Includes:

- sanitized public snapshot
- static public pages
- Research Command Center
- glossary / methodology / research articles
- SEO metadata and sitemap
- optional analytics
- optional advertisements

Zone C has no write capability into Zone A or Zone B.

## Non-interference invariants

### NIF-001 — One-way data flow

Only completed, immutable, allowlisted outputs may flow from Zone A to Zone C. No public input or event flows back.

### NIF-002 — Separate success criteria

Current BUY and LINE success must be determined without checking public export, public deploy, DNS, Cloudflare, Search Console, analytics or advertisements.

### NIF-003 — No public call in the critical path

The authoritative path must not `await`, synchronously invoke or transactionally couple to:

- public snapshot export
- public validation
- static-site build
- public deployment
- cache purge
- sitemap generation
- analytics submission
- advertisement loading

### NIF-004 — No live public database path

Public requests never reach the Mac, SQLite, sidecar, archive, runner or existing local Express endpoints.

### NIF-005 — Static request behavior

A crawler or visitor may read only prebuilt files or edge-cached public responses. Requests cannot trigger prediction, odds fetch, research, notification, database refresh or exporter execution.

### NIF-006 — Read-only extraction

The public exporter uses one of:

1. a completed immutable upstream artifact,
2. a read-only database connection with write protection,
3. a consistent copied snapshot.

It must not run migrations, inserts, updates, deletes, notification creation or decision persistence.

Recommended SQLite protections when a DB read is unavoidable:

- open read-only
- `PRAGMA query_only = ON`
- short `busy_timeout`
- no WAL checkpoint
- bounded query count and duration
- abort rather than waiting on an authoritative writer

### NIF-007 — Separate process and lock

Public work uses a separate command, process, lock name, temp directory and output directory. It never shares the authoritative runner lock or marks that task failed.

### NIF-008 — Lower resource priority

Public export/build runs with bounded CPU, memory, I/O and time. It skips under pressure instead of competing with BUY/LINE.

Operational recommendations:

- run after the authoritative cycle, not before or during cutoff-sensitive work
- use a hard timeout
- set low process priority where supported
- cap concurrency at one
- avoid full-archive scans
- prefer incremental aggregate input
- retain last-known-good when skipped

### NIF-009 — No shared credentials

Public deploy and ad/analytics credentials are not visible to Current BUY or LINE code. LINE secrets, owner identity, local paths and database credentials are not visible to public build/deploy jobs.

### NIF-010 — No shared mutable configuration

Public feature flags, SEO settings, ad settings and content configuration cannot modify `app_settings`, production approval, Current BUY thresholds or notification eligibility.

### NIF-011 — No public feedback feature

Page views, clicks, search queries, ad performance, referrers, dwell time and public user behavior are not model features, research labels or decision inputs.

A future proposal to study such signals requires a separate research hypothesis, point-in-time contract, privacy review and explicit approval. It is not an implicit optimization.

### NIF-012 — Fail stale, not authoritative

Public failure results in one of:

- skipped export
- rejected artifact
- stale banner
- last-known-good
- empty ad slot
- public outage

It never results in changed BUY status, suppressed LINE message, altered stake, delayed decision or authoritative rollback.

### NIF-013 — Fail closed on private/public classification

Unknown fields are private by default. Public serialization is allowlist-only. Schema, denylist, path, secret and holdout scans must all pass before publish.

### NIF-014 — No exact live BUY in public artifacts

Public artifacts must not contain exact live selection, current odds, required odds, recommended amount, owner history, notification identity, private decision reason or a reconstructable live candidate payload.

### NIF-015 — LINE message remains independently actionable

The LINE message must not require Public Web or Owner Web to discover the essential action. Links are optional convenience and may be unavailable.

### NIF-016 — Owner UI is ad-free by construction

Ad provider scripts and ad bundles are absent from private/owner routes, not merely visually hidden.

### NIF-017 — Public kill switch

Public export and deployment can be disabled with no code or configuration change to Current BUY and LINE.

### NIF-018 — Deletion test

The architecture should periodically prove that removing the public artifact/output and disabling public workflow leaves the authoritative test and run commands unchanged.

### NIF-019 — No public freshness pressure

Public freshness is informational. A stale snapshot must not cause a forced authoritative rerun, extra odds request, database contention or LINE resend.

### NIF-020 — No monetization pressure on correctness

SEO traffic, ad eligibility and revenue never justify loosening validation, increasing update frequency near race deadlines, exposing private fields or changing BUY behavior.

## Runtime sequence

The required conceptual order is:

```text
1. collect approved authoritative inputs
2. calculate and persist decision
3. persist LINE outbox / idempotency state
4. attempt LINE delivery under its own policy
5. complete authoritative cycle
6. optionally schedule low-priority public export
7. validate sanitized artifact
8. atomically publish or keep last-known-good
```

Steps 6–8 are not rollback participants for steps 1–5.

Public work should preferably consume a finished aggregate artifact rather than query the authoritative database again.

## Forbidden dependency examples

Public browser, contract and exporter code must not import or invoke:

- decision writers or selectors
- production approval writers
- notification writers or LINE senders
- DB initialization or migration code
- `app_settings` mutation
- automation intent or queue-state mutation
- sidecar writers
- settlement writers
- existing `/api/dashboard`
- any endpoint whose GET has side effects

Pure display types, sanitized schemas, glossary definitions and immutable aggregate DTOs may be shared when they introduce no runtime dependency toward Zone A.

## Deployment separation

Public deployment should have:

- its own workflow or explicitly isolated job
- public-only build context
- public-only secrets
- no local DB access
- no owner snapshot artifact
- no LINE secret
- no sidecar/archive artifact
- validation before upload
- atomic release or versioned last-known-good
- rollback without touching local operation

Do not deploy directly from an unvalidated exporter output path.

## Analytics and advertising separation

When enabled later:

- analytics is public-only and privacy-minimized
- owner routes do not load analytics unless separately justified
- advertisement scripts load only on approved public content routes
- ad failure leaves layout stable
- consent tooling does not block LINE or owner operation
- ad/cookie code is absent when feature flag is off
- no ad placement near BUY-like controls or misleading action surfaces
- no request from an ad provider reaches local/private infrastructure

## Verification layers

### Static architecture checks

- public source imports do not reference protected modules
- public browser code does not call known side-effect endpoints
- public browser code contains no write HTTP method
- public build contains no private snapshot or secret marker
- owner/ad bundles are separated

### Contract tests

- allowlisted fixture passes
- unknown/private fields fail
- exact BUY, odds, stake, path, token and holdout keys fail
- invalid snapshot is not rendered as current

### Runtime tests

- public exporter failure leaves authoritative exit code unchanged
- public lock contention causes skip, not wait
- public timeout keeps last-known-good
- public deploy failure does not retry Current BUY or LINE
- public site removal does not break LINE tests
- crawler load cannot reach Mac endpoints

### Diff isolation checks

Every public/product PR reports changes under:

- Current BUY logic
- `app_settings`
- notification eligibility
- automation task catalog and intent state
- sidecar/archive writers
- production approval

Expected result is zero unless a separately approved scope explicitly says otherwise.

## Required observability

Public health is observed separately from authoritative health.

Public metrics may include:

- last successful export time
- last successful deploy time
- snapshot age
- validation rejection count
- last-known-good version
- skipped-export reason

They must not alter authoritative health status or paging severity. A stale public site is lower severity than a missed eligible LINE notification.

## Kill-switch drill

Before public production activation, verify:

1. disable public export,
2. delete local generated public output,
3. disable public deploy workflow,
4. block public hosting access,
5. run authoritative tests / paper operation,
6. confirm Current BUY output and LINE eligibility are unchanged.

Record the drill evidence in the product PR or release report.

## Interpretation

Absolute mathematical proof of non-interference is unrealistic in a shared machine. The practical goal is defense in depth:

- one-way contracts
- separate processes and locks
- static serving
- no callback path
- bounded resource use
- fail-stale behavior
- CI architecture guards
- runtime fault injection
- kill-switch drills

With all layers in place, publishing the side effect becomes materially safer than leaving an ad hoc dashboard connected to the live local application.
