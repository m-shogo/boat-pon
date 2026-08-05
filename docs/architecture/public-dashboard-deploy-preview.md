# Public Dashboard Deploy Preview Boundary

Status: implementation foundation / no production deployment

Date: 2026-08-05

## Purpose

Build a deploy-ready, auditable static directory for the Boat Pon public research dashboard without including the existing local application, operational APIs, Current BUY, LINE, databases, sidecar data, credentials or automation control files.

This slice creates a GitHub Actions preview artifact only. It does not call Wrangler, Cloudflare APIs or any production deployment command.

## Build sequence

```text
public-dashboard.html + src/public-main.tsx
  -> vite.public.config.ts
  -> dist-public-dashboard/public-dashboard.html + public-only assets
  -> assemble-public-dashboard-deploy.ts
  -> index.html + public-site support files + optional verified snapshots
  -> deploy-manifest.json
  -> verify-public-dashboard-deploy.ts
  -> GitHub Actions preview artifact
```

The public Vite configuration has one HTML input. The ordinary `index.html` local application is not an input and must not appear in the output.

## Output allowlist

Root files:

- `index.html`
- `404.html`
- `robots.txt`
- `manifest.webmanifest`
- `_headers`
- `_redirects`
- `deploy-manifest.json`

Nested files:

- fingerprinted files under `assets/` with an explicit web-asset extension allowlist;
- optionally, both `public-data/latest.json` and `public-data/last-known-good.json`.

The two snapshot files must be present together, independently pass the public snapshot schema and SHA-256 integrity verifier, and preserve `latest.dataAsOf >= lastKnownGood.dataAsOf`.

## Fail-closed rules

Assembly or verification fails when any of the following occurs:

- a symbolic link is present;
- the isolated Vite output does not contain `public-dashboard.html`;
- the output already contains another `index.html`;
- a file is outside the root/assets/public-data allowlist;
- a database, SQLite WAL/SHM, environment file or source map is present;
- an individual public file exceeds 8 MiB;
- HTML references a missing built asset;
- the built entry is not the `public-root` application;
- a snapshot is unsigned, modified, invalid or rolled back;
- the manifest file set, byte length or SHA-256 digest differs from the actual artifact;
- the manifest contains an absolute, parent-relative, backslash or duplicate path;
- public output contains operational API or runtime dependency markers.

The JavaScript bundle contains the public schema's own forbidden-key detection literals. Therefore private-field scanning is strict for HTML/JSON/text artifacts, while JavaScript scanning is restricted to executable-risk markers such as operational API routes, SQLite clients and source-map references. Source import isolation remains enforced separately by `verify-product-boundaries.mjs`.

## Static hosting controls

`public-site/_headers` applies a restrictive Content Security Policy, disables framing and sensitive browser capabilities, and gives public snapshot JSON `Cache-Control: no-store`. Fingerprinted assets receive immutable caching.

`public-site/_redirects` canonicalizes `/public-dashboard.html` to `/`.

Cloudflare Workers Static Assets supports `_headers` and `_redirects` files in the static asset directory:

- https://developers.cloudflare.com/workers/static-assets/headers/
- https://developers.cloudflare.com/workers/static-assets/redirects/

No Cloudflare-specific credential, project ID or deployment configuration is introduced by this slice.

## Preview workflow

`.github/workflows/public-dashboard-preview.yml` is intentionally manual-only.

Properties:

- `workflow_dispatch` only;
- `contents: read` only;
- fixed concurrency group;
- no schedule;
- no self-hosted runner;
- no Cloudflare credential;
- no deploy command;
- seven-day GitHub artifact retention.

The workflow builds the isolated entry, assembles the allowlisted directory, verifies the manifest and uploads only `dist-public-deploy`.

The workflow cannot be manually dispatched from the GitHub UI until it exists on the default branch. Its implementation is still validated on the PR through the repository test suite, including a real programmatic Vite build.

## Runtime non-interference

This work does not modify or invoke:

- Current BUY;
- selector/model parameters;
- LINE content or delivery state;
- operational DB/schema;
- `app_settings`;
- automation task catalog, intents, queue state or processed ledger;
- sidecar data;
- holdout data;
- production approval;
- Cloudflare deployment;
- advertising network integration;
- automated betting.

## Later activation

After the N2-010 coordination hold is cleared and PR #31 -> #32 -> #33 -> this slice are merged in order:

1. dispatch the preview workflow;
2. download and independently verify `deploy-manifest.json`;
3. inspect `index.html`, snapshot source state, 404 behavior and security headers in a local static server;
4. add a separate Cloudflare deployment PR with explicit project configuration and least-privilege credentials;
5. keep deployment failure optional and downstream from Current BUY/LINE.
