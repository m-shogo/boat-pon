# Boat Pon Safe Growth Implementation Roadmap

Status: current execution roadmap
Date: 2026-08-05
Base main SHA: `bc10f799818bbc31ea7874397643ebb66cb29812`

## 1. Goal

Boat Pon must keep the existing Current BUY and LINE operation stable while continuously accumulating durable knowledge and opening a reproducible research-to-evaluation loop.

The roadmap optimizes for this order:

1. correct Current BUY;
2. timely and idempotent LINE delivery;
3. durable decision/outcome evidence;
4. reproducible research and evaluation;
5. safe knowledge retrieval and reuse;
6. automatic Cloudflare public projection;
7. SEO and optional advertising.

A lower-priority lane must never become a runtime dependency of a higher-priority lane.

## 2. Non-negotiable invariants

- Current BUY conditions remain frozen unless a separate approved production gate exists.
- Scheduled research remains disconnected from Current BUY, `app_settings`, notification eligibility and production writers.
- Public Web, Cloudflare, SEO, analytics and advertising never feed Current BUY or research authority.
- Knowledge may be accumulated automatically; behavior adaptation is versioned, evaluated and human-gated.
- N2 scheduled work and engineering work must not write the same authority/state files concurrently.
- No duplicate dispatch of a task in `CLAIMED` or `RUNNING` state.
- No task is reported complete until its artifact, evidence and queue-state transition are visible on the automation authority branch.
- Failures, negative results and blocked engineering requirements are retained as durable knowledge.

## 3. Current measured state

### Scheduled research lane

- `TASK-N2-001` through `TASK-N2-006`: `PASS`.
- `TASK-N2-010` corrected dataset expansion: dispatch intent committed at 2026-08-05 15:00 JST.
- Automation authority branch still showed `TASK-N2-010=READY` when this roadmap was created; completion was not yet confirmed.
- `TASK-N2-011` and later N2 tasks are `BLOCKED_EXECUTOR_PENDING`.

Therefore:

- do not create another N2-010 intent;
- the scheduled lane must verify the existing intent/result on its next run;
- engineering may proceed only in isolated files that do not mutate automation branch state or Current BUY behavior.

### Knowledge-retention lane

Active:

- raw archive and point-in-time evidence;
- `decision_history` audit context;
- settlement/result evidence;
- append-only Experiment / Discovery / Rejection / Transfer / Promotion registries;
- research-governance CI and lineage checks.

Pending:

- formal Runtime Decision Ledger;
- formal Outcome Learning Ledger;
- formal Forward Evaluation Vault;
- complete retrieval-before-proposal indexing;
- automatic public snapshot exporter and Cloudflare deployment.

## 4. Two-lane execution model

### Lane A — Scheduled N2 research

Authority:

- task definitions: `main/automation/task-catalog.json`;
- mutable queue/state/results: `automation/boat-pon-research` branch;
- one Scheduled Task run: at most one immutable intent commit.

Order:

1. confirm N2-010 result;
2. implement and execute N2-011 PIT audit;
3. N2-020 market-only baseline;
4. N2-021 historical-only baseline;
5. N2-022 common-cohort comparison;
6. N2-030 evaluation metrics;
7. N2-040 edge hypothesis scan;
8. N2-041 historical edge test;
9. N2-042 confounder/rejection audit.

### Lane B — Engineering and product foundation

Authority: isolated PR branches from current `main`.

Order:

1. BUY/LINE non-regression and architecture boundary gate;
2. self-contained LINE BUY message contract;
3. Runtime Decision Ledger contract and read-only reconciliation prototype;
4. Outcome Learning Ledger contract and settlement linkage;
5. Forward Evaluation Vault contract;
6. public snapshot exporter;
7. Cloudflare deployment automation;
8. Public Web, SEO and optional ads.

Lane B must not directly modify mutable queue-state on the automation authority branch.

## 5. Implementation phases

## Phase G0 — BUY/LINE safety foundation

Status: **IN PROGRESS**

Deliverables:

- CI guard preventing protected BUY/LINE code from importing research/public/cloud runtime code;
- CI guard preventing research code from importing LINE sender, notification state or production decision writers;
- versioned self-contained LINE BUY message contract and golden tests;
- explicit dedupe identity and freshness fields in the contract;
- no integration into live notification behavior in the first slice.

Exit criteria:

- existing tests and build pass;
- Current BUY, notification SQL/state transitions and real LINE sending remain unchanged;
- guard fails on deliberate reverse-dependency fixtures or forbidden imports;
- message contract can represent complete, partial and blocked data without Public Web.

## Phase G1 — Confirm N2-010 and open N2-011

Status: **WAITING FOR EXISTING SCHEDULED RESULT**

Deliverables:

- N2-010 artifact, digest, readback and queue-state evidence;
- no duplicate intent;
- if failed, classify root cause and repair only that executor/control path;
- N2-011 engineering requirement converted into a tested executor implementation.

N2-011 acceptance criteria:

- read-only inputs;
- untouched holdout exclusion verified;
- same-race and future-row leakage rejected;
- scheduled-close version respected;
- deterministic artifact and digest;
- no Current BUY, LINE or `app_settings` import;
- dry-run and fixture tests.

## Phase G2 — Runtime Decision Ledger

Status: **PLANNED**

First slice is read-only and shadow-only:

```text
existing decision_history
-> canonical mapper
-> temporary/new isolated ledger store
-> reconciliation report
```

Minimum identity:

- decision ID and canonical race ID;
- decision system;
- strategy/model/feature/manifest/cohort versions;
- decision and observation timestamps;
- selection, ticket type and decision;
- current/required odds, probability and EV;
- reason, warnings, completeness and freshness;
- notification eligibility/dedupe identity.

Rules:

- no change to Current BUY calculation;
- no write in the BUY/LINE critical transaction in the prototype;
- idempotent backfill and conflict detection;
- no overwrite of decision-time meaning.

## Phase G3 — Baselines and comparable metrics

Status: **BLOCKED BY N2-011**

Deliverables:

- market-only and historical-only baselines on the same frozen cohort;
- common-cohort comparison with Legacy benchmark;
- logloss, Brier, calibration, coverage, SKIP rate, ROI, drawdown and losing streak;
- max-hit-removed and period/venue/ticket stability;
- BUY-time odds separated from closing odds.

## Phase G4 — Outcome Learning Ledger

Status: **PLANNED**

Deliverables:

- versioned decision-to-outcome link;
- result, settlement, refund, cancellation and invalid status separated;
- revision history retained append-only;
- unresolved and ambiguous joins fail closed;
- paper stake/return and actual-purchase status represented separately;
- reconciliation completeness report.

## Phase G5 — Forward Evaluation Vault

Status: **PLANNED**

Deliverables:

- immutable cohort membership snapshot;
- immutable evaluation protocol;
- strategy/model/version pinning;
- append-only forward decisions/outcomes;
- no post-result cohort edits;
- comparable common-cohort and selected-race reports;
- promotion remains disconnected.

## Phase G6 — Edge discovery and transfer

Status: **BLOCKED BY G3-G5**

Deliverables:

- hypothesis/mechanism/required-data/falsification contract;
- novelty check against Experiment, Discovery and Rejection registries;
- historical, validation, untouched holdout and shadow-forward separation;
- confounder and multiple-testing audit;
- Discovery or Rejection recording;
- Transfer Experiment as the only adoption path.

## Phase G7 — Automatic public projection

Status: **PLANNED; LOWER PRIORITY**

Pipeline:

```text
completed authoritative output
-> low-priority read-only exporter
-> allowlist serializer
-> schema/secret/holdout/path validation
-> canonical digest
-> atomic latest + versioned snapshot
-> automatic Cloudflare deploy/update
-> readback verification
-> last-known-good on failure
```

Rules:

- no public request path to the Mac;
- public failure never retries or rolls back BUY/LINE;
- local DB, sidecar, archive and private owner snapshot are not uploaded;
- D1 is not introduced without a concrete dynamic-query requirement;
- billing changes require owner approval.

## Phase G8 — Public Web, SEO and optional advertising

Status: **PLANNED; LAST**

Order:

1. public dashboard and glossary;
2. research/methodology/data-quality/rejection pages;
3. static route registry, canonical, sitemap, robots, OGP and 404/noindex;
4. Search Console and privacy-safe monitoring;
5. advertising disabled by default;
6. manual low-density ad slots only after content and policy readiness.

Ads, clicks and SEO metrics never become model or BUY features.

## 6. Collision matrix

| Area | Scheduled lane | Engineering lane | Rule |
|---|---|---|---|
| `automation/control/*` on authority branch | read/write by orchestrator | read-only | never hand-edit from product PR |
| `automation/requests/intents/*` | Scheduled Task adds one | no writes | avoid duplicate dispatch |
| N2 reports on authority branch | executor writes | read-only | do not copy provisional results to main as authority |
| Current BUY selector/live monitor | no access | protected | behavior change requires separate gate |
| `scripts/notify-line.ts` / LINE sender | no access | protected | no research/public dependency |
| research executors | scheduled execution | implementation PRs | executor code may not import notification/production writers |
| public exporter/web | no access | isolated | low priority, one-way only |

## 7. Pull-request slicing

Keep PRs small and independently reversible:

1. `G0-A`: roadmap, boundary policy/CI and message contract;
2. `G1-A`: N2-011 executor fixtures and dry-run;
3. `G2-A`: Runtime Decision Ledger schema/types/validator;
4. `G2-B`: read-only mapper/backfill prototype and reconciliation;
5. `G3-*`: one executor family per PR;
6. `G4-A/B`: Outcome Ledger contract, then linker/reconciliation;
7. `G5-A/B`: Forward Vault contract, then append-only store/report;
8. `G7-*`: exporter, artifact validation, Cloudflare deploy separately.

Do not combine production behavior change with storage, public web or research executor work.

## 8. Definition of safe growth

The system may be described as safely growing when:

- Current BUY and LINE are covered by non-regression gates;
- all decision-time context is reproducibly retained;
- decisions reconcile to final versioned outcomes;
- evaluation cohorts and protocols are immutable;
- research failures and rejections are retrievable;
- N2 research can progress through executors without production imports;
- discoveries cannot auto-promote;
- public publication is automatic but removable without operational impact;
- a new agent can resume work from Git authorities instead of chat memory.

## 9. Immediate next actions

1. Complete `G0-A` in an isolated PR.
2. Observe the already-dispatched N2-010 result; do not duplicate it.
3. Start `G1-A` only after N2-010 evidence is visible or a concrete failure is classified.
4. Start Runtime Decision Ledger contract work after the G0 guard is merged; its first implementation remains read-only and shadow-only.
