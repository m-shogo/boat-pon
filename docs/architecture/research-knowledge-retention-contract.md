# Research Knowledge Retention Contract

Status: authoritative architecture contract
Date: 2026-08-05
Scope: scheduled research, Current BUY observation, outcome learning, research promotion

## 1. Purpose

Boat Pon must become more knowledgeable over time without silently changing or corrupting Current BUY.

This contract distinguishes two meanings that must never be confused:

1. **knowledge accumulation** — preserve facts, decisions, outcomes, experiments, discoveries and failures so later work can retrieve and reuse them;
2. **behavior adaptation** — change a model, selector, BUY/WATCH/SKIP condition or production decision.

Knowledge accumulation is expected and may be automatic. Behavior adaptation is gated, versioned and requires the existing research validation and human approval path.

A scheduled task has not created durable knowledge merely because it produced a chat response. A result becomes retained knowledge only when it is written to an approved store with identity, timestamp, evidence stage, lineage and integrity checks.

## 2. Priority and non-interference

Priority order:

1. correct Current BUY decision;
2. timely, idempotent LINE notification;
3. authoritative decision and outcome persistence;
4. research evidence and evaluation;
5. knowledge summarization and retrieval;
6. public projection.

Knowledge-writing work must not delay, mutate, retry or roll back Current BUY or LINE.

The scheduled research lanes remain disconnected from production BUY and `app_settings`. A discovery is not a BUY rule. A positive ROI result is not a promotion. Public-site content is not a research input or authority.

## 3. Knowledge layers and authorities

### K0 — Raw evidence memory

Purpose: preserve what was observed and when.

Authority:

- immutable raw archive;
- local sidecar / SQLite observation stores;
- content hashes and capture / parse lineage.

Contains:

- official source bytes or approved normalized evidence;
- observation timestamp and source timestamp;
- parser and canonicalization version;
- race identity;
- odds, program, racer, weather, exhibition, equipment and settlement observations;
- missingness and source-quality metadata.

Rules:

- raw evidence is not committed to Git;
- no secret-bearing request data;
- no overwrite of historical observation meaning;
- future information must not be relabeled as pre-race evidence.

### K1 — Operational decision memory

Purpose: preserve exactly what Current BUY knew and decided at the decision time.

Authority:

- local `decision_history` and associated audit persistence;
- notification state / delivery evidence;
- settlement and result records.

Minimum retained context:

- race and decision identity;
- decision system and strategy / model / feature version;
- decision timestamp and odds snapshot timestamp;
- candidate, decision, reason and block reason;
- feature adjustment and breakdown;
- data completeness and freshness;
- notification eligibility and delivery identity;
- later settlement / return / invalidation linkage.

This layer records behavior. It does not automatically change behavior.

### K2 — Formal research memory

Purpose: preserve what was attempted, learned, rejected and transferred.

Authority:

- `research/registries/` individual-file, append-only registries;
- schemas under `config/research-governance/`;
- validators and lineage checks under `src/research/governance/`.

Registry classes:

- Experiment (`EXP-*`);
- Discovery (`DISC-*`);
- Strategy Family (`STRAT-*`);
- Strategy Version;
- Transfer Experiment (`XFER-*`);
- Promotion (`PROMO-*`);
- Rejection / negative result (`REJ-*`).

Rules:

- one record per file;
- append-only;
- digest protected;
- no dangling lineage;
- duplicate IDs rejected;
- same ID with different content fails closed;
- failure and negative result are retained, not deleted;
- Discovery adoption requires an accepted Transfer Experiment;
- production connection remains false until the approved future gate.

### K3 — Evaluation memory

Purpose: preserve comparable, reproducible performance evidence.

Planned authorities:

- Runtime Decision Ledger;
- Outcome Learning Ledger;
- Forward Evaluation Vault;
- versioned dataset / feature / cohort artifacts, eventually Parquet / DuckDB where scale requires it.

Required separation:

- historical vs validation vs untouched holdout vs shadow-forward vs future-only;
- selected-race ROI vs common-cohort comparison;
- BUY-time odds vs closing odds;
- probability quality vs market edge vs ticket selection vs ROI;
- Current BUY benchmark vs new research decision system;
- normal ROI vs max-hit-removed ROI;
- gross result vs refunds / invalid / cancelled outcomes.

Current status: these ledgers are designed but not all are implemented as a complete formal closed loop. Existing decision, settlement and report infrastructure provides partial operational evidence, but it must not be overstated as a complete autonomous learning system.

### K4 — Method and governance memory

Purpose: preserve how evidence must be interpreted and reproduced.

Authority:

- ADRs;
- `docs/research-platform-master-plan.md`;
- `docs/research-strategy-governance.md`;
- `docs/edge-discovery-system.md`;
- `docs/research-storage-architecture.md`;
- schemas, manifests and code versions;
- concise report summaries and runbooks in Git.

This layer stores contracts and interpretation rules, not large evidence payloads.

### K5 — Public projection

Purpose: publish approved sanitized byproducts.

Authority: none for research or BUY.

Cloudflare / Public Web receives only a validated projection of lower layers. Public JSON, SEO pages, analytics and advertising metrics must never become the source of truth for Current BUY, research outcomes, training data or promotion.

Deleting the public site must not delete or reduce retained knowledge.

## 4. What the scheduled research must retain

Each successful scheduled research execution must produce durable output in at least one approved category:

1. evidence artifact with identity, hash and lineage;
2. append-only Experiment / Discovery / Rejection / Transfer record;
3. reproducible evaluation artifact with protocol, cohort and versions;
4. an `ENGINEERING_REQUIRED` or blocked report identifying the missing executor / dependency;
5. a governance finding with evidence references.

A prose-only status message is insufficient.

Every retained research result should answer:

- What question was tested?
- What mechanism was hypothesized?
- What data and time boundary were used?
- What protocol and version were fixed before evaluation?
- What was observed?
- What could falsify the conclusion?
- What failed or remained unavailable?
- Which prior Experiment / Discovery / Rejection does it relate to?
- What is the evidence stage?
- Is it reusable fact, research method, strategy-specific result or rejection?
- Is any adoption or promotion permitted? Usually no.

## 5. Smart retention rules

### 5.1 Preserve facts separately from conclusions

A result such as “ROI was high” is not stored without sample size, period, cohort, odds basis, result semantics, max-hit dependence and evidence stage.

### 5.2 Preserve rejected ideas

Rejections are first-class knowledge. Future Novelty Gate checks them before proposing a similar experiment. A failed hypothesis must not be rediscovered every week under a new name.

### 5.3 Preserve lineage, not just summaries

A Discovery references source Experiments. A Transfer references a source Discovery. A Promotion references accepted Transfer evidence. Reports link to immutable or versioned artifacts.

### 5.4 Preserve uncertainty

Missingness, freshness, source quality, sample count, confidence interval where applicable, multiple-testing family and trial count are retained with the result.

### 5.5 Retrieve before proposing

Daily Discovery must search existing Experiment, Discovery and Rejection records before creating a new proposal. Similarity or duplicate findings should extend or reference existing lineage rather than create disconnected knowledge.

### 5.6 Never train on the public projection

Public traffic, clicks, SEO queries, ad metrics and public snapshot contents are excluded from training and BUY input unless a separate future research proposal explicitly defines legality, privacy, PIT, mechanism and holdout treatment.

## 6. Promotion boundary

The following path is required:

```text
raw / operational evidence
-> Experiment
-> reproducible evaluation
-> Discovery or Rejection
-> accepted Transfer Experiment when adoption is proposed
-> human-approved research promotion
-> separate production gate
-> versioned rollout with rollback
```

Prohibited shortcuts:

- report directly to Current BUY;
- Discovery directly to selector;
- scheduled task directly to production;
- high historical ROI directly to active rule;
- public popularity directly to model feature;
- overwrite of Current BUY under the label “learning.”

## 7. Current implementation status

| Capability | Status | Authority / note |
|---|---|---|
| raw immutable evidence | active | local archive / replay foundation |
| point-in-time and lineage contracts | active | research replay and governance checks |
| Current BUY decision audit context | active | local `decision_history` and audit fields |
| append-only research registries | active | `research/registries/` |
| registry digest and dangling-lineage checks | active | CI `research:governance-check` |
| scheduled three-lane operating model | active | hourly / daily discovery / weekly governance |
| Current BUY and new research separation | active | distinct `decisionSystem`; promotion disconnected |
| formal Runtime Decision Ledger | designed / pending | implement by dependency order |
| formal Outcome Learning Ledger | designed / pending | implement after decision / settlement identities are fixed |
| formal Forward Evaluation Vault | designed / pending | requires frozen cohorts and evaluation protocol |
| automatic model retraining | prohibited / not implemented | future explicit proposal only |
| automatic production promotion | prohibited | human approval plus production gate required |

## 8. Required next implementation sequence

The following work closes the gap without changing Current BUY:

1. inventory existing decision, notification, settlement and report fields against K1 requirements;
2. define canonical Runtime Decision Ledger contract and read-only backfill / reconciliation plan;
3. define Outcome Learning Ledger contract linking decisions to final outcomes, refunds and invalidation;
4. define Forward Evaluation Vault with frozen cohort membership and immutable evaluation protocol;
5. add retrieval indexes that search Experiment / Discovery / Rejection before proposal generation;
6. add completeness reporting: which scheduled runs produced durable knowledge and which produced only status;
7. add CI / governance checks for lineage, stage separation and accidental production connection;
8. only after sufficient forward evidence, evaluate a Transfer Experiment; do not change Current BUY in this sequence.

## 9. Definition of done for “the system learns safely”

Boat Pon may be described as safely learning only when all are true:

- every acted-on decision has immutable decision-time context;
- final outcomes reconcile to decisions without ambiguous race / ticket identity;
- evaluations are reproducible from frozen protocol and evidence;
- historical, holdout and forward results cannot be mixed accidentally;
- rejected hypotheses are retrieved before new experiments are created;
- discoveries have complete source lineage;
- model / strategy changes are versioned and rollbackable;
- no scheduled task can change Current BUY or production without a separate approved gate;
- public publication can be disabled with no knowledge loss;
- a new agent can locate facts, methods, decisions, outcomes and rejected ideas from documented authorities rather than relying on chat memory.

## 10. Operational interpretation

The present system is already accumulating substantial durable knowledge through local evidence, decision audit data, reports and append-only Git registries.

It is not yet correct to claim that it autonomously retrains or safely changes BUY from every result. That final closed loop remains intentionally gated. Until the K3 ledgers are complete, the safe statement is:

> Boat Pon automatically preserves and organizes research knowledge while Current BUY remains frozen; it does not automatically promote that knowledge into BUY behavior.
