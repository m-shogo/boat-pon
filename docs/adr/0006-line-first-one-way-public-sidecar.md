# ADR-0006: LINE-first operation and one-way public sidecar

- status: accepted
- date: 2026-08-05
- clarified: 2026-08-05 — public publication is automatic and Cloudflare-hosted
- supersedes: the assumption that Owner Web is required in the daily BUY path
- complements: ADR-0004 local-first storage, ADR-0005 public/owner boundaries

## Context

Boat Pon exists first to improve the owner's actual manual BUY operation. The owner intends to rely on LINE as the operational surface and does not expect to visit the public site during normal operation.

The public site is a passive publication of already-produced research byproducts. It is worth keeping online when hosting remains free or negligible-cost, and SEO / advertising readiness may be developed, but public traffic and advertising revenue are not product dependencies.

The principal risk is not only private-data leakage. A public exporter, deployment, crawler, analytics script, advertisement or content workflow must never alter, delay, block, reorder or feed back into Current BUY or LINE delivery.

## Decision

### 1. Operational source of truth

LINE is the only relied-upon owner-facing operational surface in v1.

A BUY-eligible LINE message must be sufficiently self-contained for the owner to act without opening Public Web or Owner Web. It should carry, subject to the approved private notification contract:

- venue and race
- selection
- close time and freshness timestamp
- current odds and required odds
- estimated hit rate / EV when available
- recommended amount when approved by the existing Current BUY contract
- data completeness and blocking warnings
- decision/model version
- concise reason

Owner Web may provide optional drill-down, history and manual records later. Its availability is not required for Current BUY calculation, LINE eligibility, LINE delivery or manual purchase.

### 2. Public Web is a passive sidecar

Public Web consumes only an immutable, validated, sanitized snapshot produced after the authoritative local work has completed.

The permitted dependency direction is:

```text
Current BUY / research evidence
            |
            | completed authoritative output
            v
   automatic low-priority exporter
            |
            v
 validated public snapshot
            |
            | automatic upload/deploy
            v
 Cloudflare-hosted static Public Web / SEO / ads
```

No path may point upward from Public Web, its analytics, its advertisements, its traffic, its cache or its deployment into Current BUY, research decisions, `app_settings`, LINE eligibility or LINE delivery.

### 3. Automatic Cloudflare publication is required

“Public work is lower priority” does **not** mean manual copying, ad-hoc operation or leaving the public artifact only on the Mac.

The intended steady-state pipeline is automatic:

```text
Mac authoritative run completes
  -> public export trigger is queued
  -> exporter reads a completed read-only source
  -> allowlist serialization
  -> schema / secret / holdout / path validation
  -> canonical digest
  -> atomic latest + versioned artifact publication
  -> Cloudflare Workers Static Assets deploy and/or Cloudflare-hosted snapshot update
  -> readback / health verification
  -> last-known-good retained on failure
```

The public HTML, CSS, JavaScript, images and approved sanitized snapshots are stored and served from Cloudflare. Public browser requests do not reach the Mac.

Automation may be event-driven after meaningful research updates, scheduled at a bounded cadence, or both. It must retry independently and surface stale publication state without requiring the owner to run a manual copy command.

“Run when resources are available” means the automatic exporter has lower process priority, a time budget, lock avoidance and skip/retry rules. It does not mean the owner must notice idle time or initiate publication.

For v1:

- Workers Static Assets is the preferred public application host.
- A small sanitized snapshot may be bundled into a static deployment or stored in a minimal Cloudflare data service when independent data refresh is needed.
- D1 is not required for a read-only aggregate snapshot and must not be introduced without a concrete need.
- The 9 GB sidecar, 43 GB archive, local SQLite database and private owner snapshot are not uploaded to Cloudflare.
- Cloudflare credentials belong only to the publication boundary, not to Current BUY or LINE code.
- Paid-plan or billing changes require explicit owner approval.

### 4. No shared critical transaction

Public export and deploy are not part of the success transaction for:

- decision generation
- Current BUY persistence
- notification eligibility
- LINE outbox persistence
- LINE delivery attempt
- settlement or result processing

The authoritative operation commits first. Public work occurs in a separate command, process, output path, lock and failure domain.

A public failure is recorded as public staleness only. It must not roll back, mark failed or retry the authoritative BUY/LINE pipeline.

### 5. Resource priority and skip behavior

Public work is automatic, best-effort and lower priority than BUY and LINE work.

A public export attempt may be deferred or skipped when:

- the authoritative runner is active
- a local database is busy or locked
- the host is under CPU, memory or I/O pressure
- the source snapshot is incomplete
- the export exceeds its time budget
- validation or leakage checks fail

A deferred attempt is retried by the publication scheduler or next eligible trigger. Last-known-good remains published and a stale marker may be shown. The owner is not expected to perform manual copying.

The public exporter must use read-only access or an immutable copy. It must not acquire a write lock, run migrations, create notification records, modify decision history or invoke an existing endpoint with side effects.

### 6. Static-by-default serving

Search crawlers and visitors receive prebuilt static content or a Cloudflare-hosted static snapshot. A public request must not trigger local computation, live database reads, research execution, odds fetching, notification processing, Mac wake-up or deployment.

Public traffic spikes, abusive crawlers and advertisement scripts therefore cannot consume the Mac research data plane.

### 7. SEO and advertising are bounded optimizations

SEO, content generation and advertising are allowed only when they satisfy all of the following:

- no change to Current BUY or LINE contracts
- no required runtime dependency for owner operation
- no owner/private data in public artifacts
- no public request-time computation on the Mac
- no advertisement code in LINE or owner/private surfaces
- no analytics or engagement signal used as a model feature or decision input
- no paid hosting or external billing action without explicit owner approval

Advertising remains disabled by default. A future public-site shutdown or ad-provider rejection has zero owner-operation impact.

### 8. Kill switches

The design must support independently disabling:

1. public export,
2. public deployment,
3. public site serving,
4. analytics,
5. advertising,
6. optional Owner Web,

while leaving Current BUY and LINE operation unchanged.

The reverse is not permitted: disabling Current BUY or LINE may stop publication freshness, but Public Web must never keep authoritative operation alive or substitute for it.

## Required invariants

- `LINE_OPERATION_INDEPENDENT_OF_PUBLIC=true` as an architectural invariant, not merely configuration.
- `PUBLICATION_AUTOMATED=true`: normal public updates require no manual copy step.
- `PUBLIC_REQUEST_PATH_TO_MAC=false`: Cloudflare serves public traffic without reaching the Mac.
- Public code has no import path to decision writers, notification writers, SQLite writers, `app_settings`, production approval or automation intent state.
- Public export is never awaited by the BUY/LINE critical path.
- Public deploy credentials are unavailable to Current BUY code and Current BUY secrets are unavailable to the public build.
- Public analytics, SEO metrics, ad metrics and user behavior are never training or decision features without a separate future research proposal and explicit approval.
- Public stale state is preferable to delaying or changing a BUY notification.
- The system remains operational when the public site is deleted entirely.

## Failure matrix

| Failure | Current BUY | LINE | Public site | Required response |
|---|---|---|---|---|
| Public exporter fails | unchanged | unchanged | last-known-good / stale | queue independent retry; no manual copy required |
| Public validation fails | unchanged | unchanged | no deploy | reject artifact and retain last-known-good |
| Cloudflare unavailable | unchanged | unchanged | unavailable/stale | publication retry only; no authoritative retry |
| Mac is busy during scheduled export | unchanged | unchanged | previous snapshot remains | defer and retry automatically |
| SEO crawler spike | unchanged | unchanged | edge-limited | no Mac request path |
| Ad script fails | unchanged | unchanged | ad slot empty | preserve layout |
| Owner Web unavailable | unchanged | self-contained message remains usable | optional feature unavailable | no BUY suppression |
| LINE delivery fails | decision remains authoritative | retry/idempotency policy applies | unchanged | alert through approved operational path |
| Current BUY unavailable | no fabricated BUY | no BUY notification | public may show stale research only | fail closed |

## Consequences

### Positive

- The owner's only relied-upon flow stays small: local decision to LINE to manual purchase.
- Public publication is continuously maintained without becoming owner work.
- Cloudflare absorbs public traffic and serves the public artifact independently from the Mac.
- Public publication can be improved aggressively without becoming operational debt.
- Free hosting, SEO and advertising remain useful optional upside.
- Public outages and experiments cannot silently change BUY behavior.

### Trade-offs

- Public data may lag and may occasionally skip one publication attempt.
- Owner Web cannot be treated as the only place containing critical BUY information.
- Some code duplication may be preferable to sharing runtime code across the public and authoritative lanes.
- Public success metrics are intentionally subordinate to owner-operation reliability.
- Publication automation needs independent monitoring, retry and last-known-good behavior.

## Explicit non-goals

- manual copying as the normal publication workflow
- serving public requests from the Mac
- making Public Web a required dashboard for the owner
- using public engagement to tune BUY decisions
- request-time prediction or research execution
- uploading the local research database or private snapshot to Cloudflare
- automatic betting
- making advertising revenue a project viability requirement
