# Standalone Public Dashboard Shell

Status: IMPLEMENTED FOUNDATION / NOT DEPLOYED
Date: 2026-08-05

## Entry

The public research dashboard is a separate Vite multi-page entry:

```text
public-dashboard.html
  -> src/public-main.tsx
  -> PublicDashboardApp
  -> /public-data/latest.json
```

It does not bootstrap the existing local `App`, call `/api/dashboard`, read the operational database or require the local server.

## Public sections

- purpose and public-data guarantees;
- sanitized Research Command Center;
- methodology reading guide for historical / forward / paper-live / holdout;
- plain-language glossary;
- responsible-play notice;
- structurally reserved advertising region.

The advertising region contains no network integration. Future advertising must remain presentation-only and must not feed Current BUY, research ranking, selector logic or LINE.

## Failure mode

When `/public-data/latest.json` is absent, invalid, stale beyond the presentation policy, future-dated or has a mismatched digest, the page renders `NOT_AVAILABLE`. It does not use the bundled fixture as current state and does not call a private fallback API.

## Build

`vite.config.ts` includes both entries:

```text
index.html              existing local application
public-dashboard.html   standalone public research dashboard
```

The existing application is not replaced. Deployment and route mapping are separate future operations.

## Safety boundary

The public shell is registered in `config/product-boundary-policy.json`. CI checks its imports and rejects protected dependencies, public write methods, owner API access, WebSocket/EventSource and environment-secret access.

No Current BUY, LINE, model, selector, operational DB, `app_settings`, sidecar, automation state, production approval, Cloudflare or betting behavior changes are included.
