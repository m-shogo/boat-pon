# Public Dashboard Snapshot Transport

Status: IMPLEMENTED FOUNDATION / NOT DEPLOYED
Date: 2026-08-05

## Purpose

Research Command Center must not infer current research state from a bundled fixture or connect the browser to the operational database. It reads one generated, sanitized and integrity-checked artifact:

```text
/public-data/latest.json
```

The transport is one-way:

```text
main task catalog + automation authority JSON
                  |
                  | explicit read-only file inputs
                  v
export-public-dashboard-snapshot.ts
                  |
                  | strict allowlist builder + SHA-256 seal
                  v
public-data/latest.json
                  |
                  | no-store fetch + schema/digest/freshness verification
                  v
Research Command Center
```

## Included sources

The exporter accepts explicit paths for:

- `automation/task-catalog.json` from main;
- `automation/control/task-queue-state.json` from the automation authority worktree;
- `automation/control/current-run.json` from the automation authority worktree;
- `reports/automation/pre-schedule-readiness.json` from the verified readiness source.

It does not discover local files implicitly and does not import `server/db.ts`.

## Excluded data

The public artifact does not copy:

- exact BUY candidates or selections;
- recommended amount or stake;
- current/required odds;
- internal thresholds or `app_settings`;
- notification identity or owner purchase history;
- credentials, tokens or local paths;
- raw holdout race keys;
- database rows, sidecar records or private runner diagnostics.

Unknown or unavailable registry counts and metrics remain `null`/`NOT_AVAILABLE`; they are not converted to zero.

## Integrity convention

The digest is SHA-256 over canonical JSON with object keys sorted and `integrity.digest` replaced by 64 zero characters. The browser performs the same calculation before displaying the snapshot.

A payload is rejected when:

- schema validation fails;
- a forbidden public key, secret-like value or absolute path is detected;
- the SHA-256 digest does not match;
- `dataAsOf` is unreasonably in the future;
- the request or JSON parsing fails.

No bundled fixture is presented as current evidence. Failure results in `NOT_AVAILABLE`.

## Freshness

The browser derives observed freshness from `dataAsOf` with a default maximum age of two hours and five minutes of future-clock tolerance. A mismatch between signed declared freshness and browser-observed freshness is shown as a warning; the browser observation controls presentation without modifying the signed artifact.

## Export command

```bash
tsx scripts/export-public-dashboard-snapshot.ts \
  --catalog automation/task-catalog.json \
  --queue-state /path/to/automation-worktree/automation/control/task-queue-state.json \
  --current-run /path/to/automation-worktree/automation/control/current-run.json \
  --readiness reports/automation/pre-schedule-readiness.json \
  --output public/public-data/latest.json \
  --model-version boat-pon-main:<short-sha>
```

The command writes atomically through an exclusive temporary file and prints only sanitized artifact metadata. It does not deploy the artifact.

## Runtime impact

This foundation does not change Current BUY, selector/model behavior, LINE, operational DB/schema, `app_settings`, automation branch state, sidecar, production approval, Cloudflare or betting behavior.
