# N2 Private Trifecta Daily Plan Cache

## Purpose

The private trifecta checkpoint collector must not lose live checkpoints merely because the primary SQLite database has an active WAL at the checkpoint instant.

The WAL guard remains a safety boundary. This change removes the need to consult the primary database on every live checkpoint when an already-validated private daily plan is available.

## Generation boundary

After current-day official program refresh and readiness validation, `scripts/daily-programs.sh` runs:

`generate-n2-trifecta-private-daily-plan.ts <current-jst-date>`

Generation is allowed only for the current JST date. It uses the existing immutable/read-only/query-only official-program reader and requires the source database WAL size to be zero while the daily plan is built.

A cache is eligible only when one venue has:

- exactly 12 races;
- exactly four checkpoints per race: T-30 / T-20 / T-10 / T-5;
- exactly 48 checkpoint entries;
- the one-venue review stage;
- a deterministic source plan digest.

The source evidence records only sanitized database metadata/fingerprint information. It does not contain raw odds or BUY decisions.

## Private persistence

The current-day plan is written under:

`data/private/trifecta-capture/plans/<date>.json`

Properties:

- atomic temporary-file then rename replacement;
- owner-only file mode 0600;
- private parent directory mode 0700;
- deterministic cache digest;
- explicit false authority for DB writes, Current BUY, LINE, public publishing and automated betting.

This private plan is operational metadata, not raw market evidence, so it is replaceable after a newer successful current-day program refresh. Raw accepted/blocked odds evidence remains append-only under the existing private raw path.

## Collector behavior

At each 30-second collector tick:

1. validate long-lived authorization and immutable runtime authority as before;
2. read the current-day private daily plan;
3. if the cache is valid, use it as the checkpoint schedule without opening or stat-gating the primary DB;
4. if the cache is missing or explicitly stale, fall back to the existing immutable DB reader;
5. the fallback path retains the existing `PRIMARY_DB_ACTIVE_WAL` guard;
6. if the cache exists but is malformed, tampered, symlinked, oversized or digest-invalid, fail closed and do not fall back to DB;
7. preserve the existing one-reservation-before-network rule, maximum 48 requests/day, one request per checkpoint, no immediate retry, and +120 second late window.

The exact checkpoint target now has zero early allowance due to PR #90.

## WAL safety proof

The integration test creates a complete private daily plan while the source DB has no WAL, then creates an active WAL before the due checkpoint tick.

The collector:

- captures exactly one due 120-selection snapshot from the cached schedule;
- does not modify the primary DB;
- does not modify the active WAL;
- performs zero DB writes;
- leaves Current BUY, LINE, public publishing and automated betting unchanged.

Without a valid daily cache, the existing active-WAL test still blocks before network.

## Protected boundaries

This change does not modify:

- Current BUY conditions or behavior;
- selector or model parameters;
- decision history;
- LINE wording, state transitions or retry behavior;
- `app_settings`;
- primary DB or sidecar schema;
- holdout or global shadow writes;
- public Cloudflare surfaces, authentication or ads;
- automated betting/purchase;
- production apply.

Raw official odds remain private and are not committed, publicly published or uploaded as GitHub Actions artifacts.
