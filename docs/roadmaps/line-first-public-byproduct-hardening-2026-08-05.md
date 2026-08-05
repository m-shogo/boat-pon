# Boat Pon LINE-first / Public-byproduct Hardening Roadmap

Status: PRODUCT AUTHORITY ADDENDUM
Date: 2026-08-05
Base roadmap: `docs/roadmaps/public-owner-dashboard-roadmap-2026-08-05.md`
Related ADR: ADR-0006

## 1. Product doctrine

Boat Pon's operational product is:

```text
Local authoritative decision
        -> LINE
        -> owner manually purchases or skips
```

The owner expects to rely on LINE, not the public dashboard. Therefore:

- LINE must be independently actionable.
- Owner Web is optional drill-down, not a mandatory step.
- Public Web is a passive, free-hosted publication of sanitized byproducts.
- SEO and advertising are optional upside, not viability requirements.
- Any public feature may be skipped or deleted to protect BUY correctness and LINE timeliness.

## 2. Immutable priority order

| Priority | Capability | Failure posture |
|---:|---|---|
| 0 | Current BUY correctness and fail-closed behavior | never trade for lower priorities |
| 1 | LINE eligibility, idempotency and timely delivery | alert/retry without altering decision |
| 2 | local persistence, audit and recovery | preserve evidence |
| 3 | optional Owner Web detail/history | may be unavailable |
| 4 | public snapshot and static site | may be stale/offline |
| 5 | SEO/content | may lag indefinitely |
| 6 | analytics/advertising | disabled by default |

## 3. Revised target architecture

```text
AUTHORITATIVE LANE
approved inputs
  -> Current BUY calculation
  -> decision persistence
  -> LINE outbox + idempotency
  -> LINE delivery
  -> manual purchase outside Boat Pon

OPTIONAL PRIVATE PRESENTATION
completed private DTO
  -> Owner Web detail/history (optional only)

PASSIVE PUBLIC LANE
completed aggregate evidence
  -> low-priority read-only exporter
  -> allowlist / leakage validation
  -> immutable versioned snapshot
  -> static build
  -> free edge hosting
  -> optional SEO / analytics / ads
```

There is no reverse arrow from either presentation lane to Current BUY or LINE.

## 4. LINE completion plan

### L1 — Canonical message contract

Define a versioned private LINE payload containing the minimum independently actionable fields:

- candidate identity and dedupe identity
- venue / race / close time
- selection
- current odds and observed-at timestamp
- required odds
- estimated probability / EV where contractually available
- approved recommended amount
- BUY / WATCH / SKIP and exact blocker
- data completeness / stale flags
- model / decision version
- concise reason
- generated-at and send-at
- optional private detail link clearly marked optional

Do not let detail pages contain the only copy of a critical value.

### L2 — Timeliness and stale suppression

Add explicit policies for:

- latest useful send time before close
- do-not-send threshold when already too late
- odds age limit
- program/before-info freshness
- stale candidate suppression
- changed-decision resend threshold
- changed-odds resend threshold
- cancellation / invalidation message

A late message should fail closed rather than invite an unsafe rushed purchase.

### L3 — Transactional outbox

Prefer an outbox pattern:

1. authoritative decision commits,
2. notification intent commits in the same authoritative local transaction where appropriate,
3. sender reads pending outbox,
4. provider delivery is attempted,
5. result is recorded idempotently.

Provider failure must not change the decision. Decision reprocessing must not duplicate the message.

### L4 — Idempotency identity

Freeze the identity components, for example:

- candidate/race identity
- decision version
- odds snapshot identity or meaningful odds band
- notification kind
- recipient identity boundary

Store provider response metadata without logging tokens or sensitive request bodies.

### L5 — Retry and terminal states

Define bounded states such as:

- PENDING
- SENDING
- SENT
- RETRYABLE_FAILURE
- TERMINAL_FAILURE
- EXPIRED
- CANCELLED
- SUPERSEDED

Use capped retry with expiry before race close. Never retry an expired BUY message after the action window.

### L6 — Operational health

Track separately:

- eligible notifications
- sent notifications
- provider errors
- duplicate suppressions
- expired-before-send
- send latency
- odds age at send
- messages superseded by newer decisions

Alert priority: missed eligible LINE is higher severity than stale Public Web.

### L7 — Human factors

Keep the message scannable on mobile:

- decision and deadline first
- selection and amount next
- odds comparison next
- blockers/warnings prominent
- reason short
- detailed evidence behind optional link

Avoid notification fatigue. WATCH and informational messages should not drown BUY alerts.

### L8 — Manual purchase safety

Retain:

- no automatic betting
- no betting-site credentials
- no auto-open purchase execution URL
- clear observed-at timestamp
- instruction to recheck live odds before manual purchase
- BUY invalidation when live conditions no longer satisfy the contract

## 5. Public-byproduct completion plan

### PB1 — Export boundary

Implement:

- dedicated read-only command
- separate lock and output path
- immutable input or read-only copy
- bounded query/time/resource budget
- skip-under-load behavior
- no dependency on `/api/dashboard`
- no notification creation
- no decision-history writes
- no `app_settings` writes

### PB2 — Validation and publication

Require:

- allowlist serializer
- JSON schema
- unknown-field rejection
- denylist scan
- secret scan
- absolute-path scan
- holdout-key scan
- canonical serialization and SHA-256 digest
- temp write + fsync where applicable + atomic rename
- readback verification
- versioned artifacts
- last-known-good pointer
- stale metadata

### PB3 — Static-only public request path

The public host serves only generated assets. No public request triggers:

- local DB reads
- prediction
- research jobs
- odds collection
- notification work
- export
- deployment

Use edge caching and crawler controls. There must be no tunnel to the Mac.

### PB4 — Kill switches

Provide independent switches for:

- export
- deploy
- analytics
- ads
- whole public host

All switches default safe and leave LINE operation intact.

### PB5 — Fault injection

Test:

- exporter exception
- DB busy
- exporter timeout
- invalid schema
- leaked forbidden key
- partial file
- digest mismatch
- deployment failure
- host outage
- crawler spike
- ad script failure

Expected result: authoritative operation unchanged, public stale/offline only.

## 6. SEO completion plan

SEO should be thorough but low-maintenance.

### SEO1 — Technical foundation

- stable clean URLs
- build-time HTML / prerender for indexable pages
- unique title and meta description
- canonical URL
- Open Graph and social image
- XML sitemap
- robots.txt
- real 404 status
- index/noindex registry
- owner/API/generated-json exclusion
- mobile-friendly layout
- performance budgets
- accessible semantic headings and links
- structured data only when content supports it
- Search Console runbook
- optional Bing Webmaster Tools runbook

### SEO2 — Route registry

Centralize for every route:

- path
- title
- description
- canonical
- indexability
- sitemap inclusion
- change frequency only when meaningful
- last meaningful update
- structured-data type

Add CI checks for duplicate or missing metadata and private URL leakage.

### SEO3 — Content pillars

Prioritize evergreen pages that reflect actual Boat Pon knowledge:

- ROI vs hit rate
- expected value
- required odds
- calibration
- drawdown
- max-hit dependence
- sample size
- historical vs forward
- paper-live
- point-in-time safety
- holdout
- common cohort
- data coverage and missingness
- why a historical edge fails forward
- why BUY=0 can be correct
- methodology and limitations
- rejected hypotheses
- correction/update policy

### SEO4 — Evidence-first article template

Every research article should state:

- question
- hypothesis
- data period
- observation timing
- sample size
- comparison cohort
- historical/forward/paper-live classification
- key result
- max-hit sensitivity
- limitations
- conclusion status
- next review trigger
- methodology version
- correction history

Do not mass-generate venue/month/race/bet-type pages unless each has distinct analysis and sufficient evidence.

### SEO5 — Trust and transparency

Publish:

- operator/project description
- non-official disclaimer
- methodology
- data sources and limitations
- update policy
- correction log
- responsible play
- privacy
- terms
- contact method with spam protection

Avoid claims of guaranteed profit, guaranteed hit rate or “AI always wins.”

### SEO6 — Measurement without feedback into BUY

Measure public search health separately:

- indexed pages
- crawl errors
- search impressions/clicks
- Core Web Vitals
- broken links
- stale pages

Never use these signals as a Current BUY or model input.

## 7. Advertisement completion plan

Advertising remains optional and off until explicitly enabled.

### AD1 — Eligibility readiness

Prepare without loading provider code:

- meaningful original content
- privacy policy
- responsible-play page
- terms
- contact
- ads.txt placeholder/runbook
- consent/CMP decision
- public-only ad layout components
- policy review checklist dated immediately before activation

### AD2 — Placement rules

Allowed candidate surfaces:

- glossary
- methodology
- explanatory articles
- completed research reports

Forbidden surfaces:

- LINE
- Owner Web
- BUY/WATCH/SKIP cards
- close-time UI
- odds comparison UI
- manual-purchase controls
- links that resemble betting actions
- error or warning dialogs

### AD3 — Technical isolation

- provider script absent when flag off
- provider script absent from owner/private bundles
- no ad cookie on owner route
- stable layout with blocked/failed ads
- content remains primary
- manual placement first; no uncontrolled auto-placement near operational UI
- CSP and consent updated only when provider activated

### AD4 — Economic guardrail

Treat revenue as cost offset only. Do not:

- increase public update pressure near race deadlines
- weaken private/public separation
- create thin pages for impressions
- place deceptive ads
- introduce paid infrastructure without explicit approval

If revenue is zero, the product remains successful because LINE operation and research continue.

## 8. Data-use, policy and responsible-play plan

Before public production:

- map every public field to its source and transformation
- verify official-site terms at the time of launch
- avoid official logos, copied page designs and bulk copied text
- publish aggregate original analysis rather than raw mirrored data
- document source attribution
- rate-limit and cache collection where applicable
- prohibit raw database downloads
- implement correction/removal procedure
- state non-official status
- display 20+ purchase restriction
- display no-guarantee and budget-control language
- retain manual purchase only

A dedicated launch audit should compare actual rendered output and collection behavior against current terms and policies. Do not rely on an old policy review.

## 9. Security and privacy plan

- CSP, HSTS, X-Content-Type-Options, Referrer-Policy and frame restrictions
- no secrets in build artifacts, source maps or logs
- no local absolute paths
- no owner/private snapshot in Git artifacts
- dependency audit and patch plan
- minimal analytics
- no fingerprinting
- no public user accounts in v1
- rate limit public dynamic endpoints; preferably have none
- cache public assets; private responses no-store
- separate credentials and workflows
- secret rotation and incident runbook before private API launch
- backup/restore for owner records only when those records exist

## 10. Cost and hosting guardrails

The public side is built to survive on free static hosting:

- no request-time database
- no server-side rendering requirement at runtime
- no per-request model computation
- compressed immutable assets
- conservative snapshot frequency
- edge cache
- bounded logs/analytics
- no large archive upload
- no paid database unless an owner-only need is proven

When a free-tier limit is approached, degrade public freshness or disable optional services before affecting LINE.

## 11. CI and release gates

Every product/public PR must verify:

1. Current BUY logic diff is zero
2. notification eligibility diff is zero unless LINE slice explicitly approved
3. `app_settings` diff is zero
4. production approval diff is zero
5. automation intent/task state diff is zero
6. sidecar/archive writer diff is zero
7. public source cannot import protected modules
8. public browser code cannot call side-effect endpoints
9. public snapshot leakage tests pass
10. build/typecheck/test pass
11. public failure does not alter authoritative test results
12. owner/private/ad bundle separation when those features exist
13. no external deployment or billing action without explicit approval

## 12. Release order

### Slice A — Non-interference authority and CI guard

- ADR-0006
- non-interference contract
- protected-module policy
- CI static architecture check

### Slice B — Public exporter P1

- read-only source adapter
- allowlist serializer
- canonical digest
- atomic/versioned output
- last-known-good
- resource timeout / skip behavior
- fault tests

### Slice C — LINE contract audit before UI growth

- inspect existing LINE sender/outbox/idempotency
- compare actual message against independently actionable contract
- fill only proven gaps
- do not change Current BUY criteria

### Slice D — Static public portal and SEO foundation

- route registry
- prerender/indexability
- sitemap/robots/canonical
- methodology/glossary/research templates
- legal/responsible-play pages
- analytics and ads still off

### Slice E — Optional Owner Web

Only after LINE is independently complete. Treat as convenience, not critical path.

### Slice F — Free deploy and kill-switch drill

- validated static deployment
- no Mac ingress
- LKG/rollback
- public deletion drill

### Slice G — Content growth

Publish a small number of evidence-rich pages from actual completed research. Avoid mass generation.

### Slice H — Advertisement activation preparation

Only after traffic/content warrants it and after a fresh policy/data-use review. Account creation and provider activation require explicit owner action.

## 13. Definition of done

The design is considered fully hardened when:

- the owner can act from LINE without visiting either web surface
- LINE dedupe, expiry, stale handling and retries are evidenced
- deleting Public Web leaves Current BUY and LINE unchanged
- public export is read-only, bounded, skippable and independently locked
- all public artifacts are allowlisted and validated
- no public request can reach the Mac or trigger computation
- public outage/deploy/ad/SEO failure only causes public degradation
- SEO technical basics are CI-checked
- content has evidence, limitations and correction policy
- ads remain public-only and optional
- data-use and responsible-play launch audit is recorded
- free-tier pressure degrades public functionality first
- Current BUY behavior has not changed as a side effect of publication work

## 14. Decision rule for future ideas

For every new public, SEO, analytics or advertising idea ask:

1. Can LINE and Current BUY operate identically if this feature is deleted?
2. Can this feature create load, a lock, a retry or a callback into the authoritative lane?
3. Can it expose or reconstruct an exact private BUY?
4. Can its metric create pressure to change BUY behavior?
5. Is it still worthwhile if revenue is zero?

Reject or redesign any idea that fails questions 1–4. Question 5 should normally be yes.
