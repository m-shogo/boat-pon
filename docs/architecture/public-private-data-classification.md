# Public / Owner Dashboard Data Classification

Status: P0 authority
Date: 2026-08-05

## Purpose

Boat Ponの既存local-first研究・Current BUY・LINE通知と、将来のPublic Web / Owner Webの間に明示的なdata contract境界を置く。

UIで隠すだけでは不十分であり、public artifactはallowlist serializerとvalidatorを通過した項目だけで構成する。

## Classification

| Class | Examples | Public snapshot | Owner API | Git artifact |
|---|---|---:|---:|---:|
| PUBLIC_AGGREGATE | generatedAt, dataAsOf, modelVersion, sample size, aggregate ROI, aggregate hit rate, sanitized pipeline status, methodology link | Yes | Yes | Yes |
| PUBLIC_STATUS | PASS / READY / RUNNING / BLOCKED / ENGINEERING_REQUIRED, snapshot freshness, data quality status | Yes | Yes | Yes |
| OWNER_PRIVATE | exact BUY/WATCH/SKIP candidate, selection, current odds, required odds, EV, recommended amount, deadline, manual purchase state, owner history | No | Authenticated only | No |
| RESEARCH_RESTRICTED | internal thresholds, unpublished hypotheses, raw holdout race keys, experiment private evidence, sidecar identifiers | No | Only when explicitly required and authorized | No |
| SECRET | token, credential, cookie, signing key, LINE secret, OAuth secret | No | Never returned as application data | No |
| LOCAL_INFRASTRUCTURE | absolute local path, DB path, archive path, WAL path, runner filesystem details | No | Operational metadata only; never browser payload | No |

## Public allowlist v1

- `schemaVersion`
- `generatedAt`
- `dataAsOf`
- `modelVersion`
- `integrity.algorithm`
- `integrity.digest`
- `status.currentPhase`
- `status.readiness`
- `status.lastRunAt`
- `status.nextTask`
- `status.runner`
- `status.snapshotFreshness`
- aggregate `metrics[]`
- sanitized `pipeline[]`
- registry counts without private IDs
- aggregate `dataQuality`
- public methodology references

## Public denylist v1

The public serializer and validator reject at minimum:

- exact `selection`
- `recommendedAmount`, `stake`, purchase amount
- `currentOdds`, `requiredOdds`, candidate EV for a live race
- `app_settings` / `appSettings`
- internal thresholds
- owner history, manual purchase state, notification identity
- secret, token, credential, authorization header
- absolute filesystem path and DB path
- raw holdout race key
- sidecar private storage details

## Existing endpoint finding

`GET /api/dashboard` is not read-only. During a GET it may:

1. insert decision history,
2. create notification records,
3. trigger push delivery.

Therefore Public Web must not call or proxy this endpoint. The public portal consumes only a separately generated, validated static snapshot. A future public API must have zero writes and must not import Current BUY persistence functions.

## Route matrix

| Route | Audience | Data source | Writes | Cache |
|---|---|---|---:|---|
| `/` `/research` `/glossary` | anonymous public | validated public snapshot | 0 | public cache allowed |
| `/api/public/snapshot` | anonymous public | validated public snapshot | 0 | public cache allowed |
| `/owner/*` | owner only | private authenticated API | manual actions only | no-store |
| `/api/owner/*` | owner only | private snapshot / owner state | explicit methods only | `private, no-store` |
| existing local `/api/dashboard` | local operator | local DB / Current BUY | yes, despite GET | never expose publicly |

## Ownership and collision rules

- Product lane owns public/owner contracts, exporters, validators and presentation components.
- Research schedule owns automation intents, queue-state and research execution.
- Product work must not write `automation/task-catalog.json`, `automation/phase-mapping.json`, automation branch state, Current BUY logic, `app_settings`, production approval or sidecar data.
- Export failure must not fail the research runner.
- Deploy uses only a newly validated snapshot; otherwise last-known-good remains active.
