# ADR-0006: LINE-first operation and one-way public sidecar

- status: accepted
- date: 2026-08-05
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
      optional exporter
            |
            v
 validated public snapshot
            |
            v
 static Public Web / SEO / ads
```

No path may point upward from Public Web, its analytics, its advertisements, its traffic, its cache or its deployment into Current BUY, research decisions, `app_settings`, LINE eligibility or LINE delivery.

### 3. No shared critical transaction

Public export and deploy are not part of the success transaction for:

- decision generation
- Current BUY persistence
- notification eligibility
- LINE outbox persistence
- LINE delivery attempt
- settlement or result processing

The authoritative operation commits first. Public work occurs in a separate command, process, output path, lock and failure domain.

A public failure is recorded as public staleness only. It must not roll back, mark failed or retry the authoritative BUY/LINE pipeline.

### 4. Resource priority and skip behavior

Public work is best-effort and lower priority than BUY and LINE work.

A public export may be skipped when:

- the authoritative runner is active
- a local database is busy or locked
- the host is under CPU, memory or I/O pressure
- the source snapshot is incomplete
- the export exceeds its time budget
- validation or leakage checks fail

Skipping public work is a successful safety outcome. Last-known-good remains published and a stale marker may be shown.

The public exporter must use read-only access or an immutable copy. It must not acquire a write lock, run migrations, create notification records, modify decision history or invoke an existing endpoint with side effects.

### 5. Static-by-default serving

Search crawlers and visitors receive prebuilt static content or a static snapshot. A public request must not trigger local computation, live database reads, research execution, odds fetching, notification processing or deployment.

Public traffic spikes, abusive crawlers and advertisement scripts therefore cannot consume the Mac research data plane.

### 6. SEO and advertising are bounded optimizations

SEO, content generation and advertising are allowed only when they satisfy all of the following:

- no change to Current BUY or LINE contracts
- no required runtime dependency for owner operation
- no owner/private data in public artifacts
- no public request-time computation on the Mac
- no advertisement code in LINE or owner/private surfaces
- no analytics or engagement signal used as a model feature or decision input
- no paid hosting or external billing action without explicit owner approval

Advertising remains disabled by default. A future public-site shutdown or ad-provider rejection has zero owner-operation impact.

### 7. Kill switches

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
- Public code has no import path to decision writers, notification writers, SQLite writers, `app_settings`, production approval or automation intent state.
- Public export is never awaited by the BUY/LINE critical path.
- Public deploy credentials are unavailable to Current BUY code and Current BUY secrets are unavailable to the public build.
- Public analytics, SEO metrics, ad metrics and user behavior are never training or decision features without a separate future research proposal and explicit approval.
- Public stale state is preferable to delaying or changing a BUY notification.
- The system remains operational when the public site is deleted entirely.

## Failure matrix

| Failure | Current BUY | LINE | Public site | Required response |
|---|---|---|---|---|
| Public exporter fails | unchanged | unchanged | last-known-good / stale | log public failure only |
| Public validation fails | unchanged | unchanged | no deploy | reject artifact |
| Cloudflare unavailable | unchanged | unchanged | unavailable/stale | no authoritative retry |
| SEO crawler spike | unchanged | unchanged | edge-limited | no Mac request path |
| Ad script fails | unchanged | unchanged | ad slot empty | preserve layout |
| Owner Web unavailable | unchanged | self-contained message remains usable | optional feature unavailable | no BUY suppression |
| LINE delivery fails | decision remains authoritative | retry/idempotency policy applies | unchanged | alert through approved operational path |
| Current BUY unavailable | no fabricated BUY | no BUY notification | public may show stale research only | fail closed |

## Consequences

### Positive

- The owner's only relied-upon flow stays small: local decision to LINE to manual purchase.
- Public publication can be improved aggressively without becoming operational debt.
- Free hosting, SEO and advertising remain useful optional upside.
- Public outages and experiments cannot silently change BUY behavior.

### Trade-offs

- Public data may lag and may occasionally skip an update.
- Owner Web cannot be treated as the only place containing critical BUY information.
- Some code duplication may be preferable to sharing runtime code across the public and authoritative lanes.
- Public success metrics are intentionally subordinate to owner-operation reliability.

## Explicit non-goals

- making Public Web a required dashboard for the owner
- using public engagement to tune BUY decisions
- request-time prediction or research execution
- automatic betting
- making advertising revenue a project viability requirement
