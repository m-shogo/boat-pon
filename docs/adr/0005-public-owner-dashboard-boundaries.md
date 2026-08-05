# ADR-0005: Public / Owner dashboard boundaries

- status: accepted for P0 implementation
- date: 2026-08-05
- supersedes: none
- complements: ADR-0004 local-first / cloud-ready storage

## Context

Boat Pon currently has a local React/Express application backed by SQLite and Current BUY logic. Some existing GET endpoints perform persistence and notification side effects. The new product lane requires an anonymous public site, an owner-only operational view and a Research Command Center without exposing the Mac database or changing research calculations.

## Decision

### 1. Snapshot boundary

Use two independent contracts:

- **Public snapshot**: allowlisted aggregate and sanitized research status only. It may be published as a static artifact after validation.
- **Owner snapshot**: exact candidate and manual-operation data. It is never committed as a public artifact and is available only through an authenticated private API.

The public portal never connects directly to SQLite, the sidecar or the existing `/api/dashboard` endpoint.

### 2. Authentication boundary

Only `/owner/*` and `/api/owner/*` are protected. The public root remains anonymous.

Owner identity is not hard-coded in source. The final provider is deferred to a later ADR after comparing:

1. Cloudflare Access with issuer/audience/identity verification,
2. GitHub OAuth with a single-owner allowlist in secret/config boundary,
3. a minimal alternative only if neither managed option is operationally suitable.

Custom password authentication is not introduced in P0.

### 3. Hosting boundary

Cloudflare Workers Static Assets is the preferred public hosting target, but P0 performs no external deployment or billing action. The Mac remains the research data plane. Large sidecar/archive data is not moved to Cloudflare.

### 4. Advertising boundary

P0 does not load advertising code. Future ad slots are feature-flagged, disabled in owner mode and separated from BUY cards and action controls. Policy review is required immediately before activation.

### 5. Failure behavior

- Invalid or stale snapshots are shown as `NOT_AVAILABLE` / stale; values are not fabricated.
- Invalid snapshots are not published.
- A failed export does not fail the research runner.
- Last-known-good remains active until a new validated snapshot exists.

## Consequences

### Positive

- Public/private separation is enforced in data contracts rather than CSS or routing alone.
- Existing Current BUY calculations remain untouched.
- Research schedule and product work can proceed on separate branches and outputs.
- Public hosting does not create an internet path to the Mac DB.

### Trade-offs

- Snapshot freshness is asynchronous rather than direct DB reads.
- Owner mode needs a later secure upload/read API and identity provider.
- Existing local endpoints cannot be reused blindly because GET is not guaranteed read-only.

## P0 non-goals

- owner login implementation
- LINE delivery changes
- Cloudflare production deployment
- advertisement activation
- automatic betting or credential storage
- Current BUY, `app_settings`, research executor or automation state changes
