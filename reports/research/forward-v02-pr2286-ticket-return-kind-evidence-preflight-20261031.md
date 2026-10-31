# Forward Vault v0.2 — ticket-level return-kind evidence preflight (2026-10-31 JST)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic contract hardening on Draft PR #2286. No source ingestion, real ticket classification, scoring, production apply, protected N2 run, or independent authority assertion.

## Question and mechanism

Can the unapproved v0.2 candidate be declared structurally complete without explicitly requiring independently attributable **ticket type + selection + terminal revision + return kind** evidence? The v487 cross-ledger audit found that Outcome Learning Ledger 0.1 has `SETTLED/REFUNDED/VOID` only; a final `SETTLED` payout alone cannot distinguish ordinary payout from 特払い. The v486 policy already excludes `SPECIAL_PAYOUT` from research ROI, but an exclusion policy is not a source classifier.

**Hypothesis:** a mandatory, exact `evidenceRequirements.terminalReturnKind` contract field prevents a candidate from silently omitting that prerequisite while retaining the existing deny-only scoring boundary.

## Concrete change

- `src/research/governance/forwardEvaluationProtocolV02Candidate.ts`: add `terminalReturnKind` to the exact evidence field inventory, requiring `INDEPENDENT_EXACT_TICKET_TYPE_SELECTION_REVISION_AND_RETURN_KIND`. An absent or alternative field fails closed with `MISSING_INDEPENDENT_EVIDENCE_REQUIREMENTS`.
- `src/research/governance/forwardEvaluationProtocolV02Candidate.test.ts`: extend the synthetic fixture; assert omission, caller assertion, payout inference, race-wide classification and return-kind evidence lacking revision all fail closed; assert the fully specified synthetic candidate remains `scoringAuthorized=false`.
- Commits: `7687d3cc863da4de020064d867bd5567e2edc100` (contract) and `ed63550bd678dc8713694fd02ef88fd8005580e0` (regression test).
- Existing Outcome Ledger 0.1 schema and digests remain untouched. No adapter, classification, evaluation, data connection, or production code was added.

## Evidence and limitations

- Pinned canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Source authority: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, Outcome Ledger 0.1 JSON schema, `forwardV02OutcomeLinkPreflight.ts`, v0.2 candidate, and v487 bridge-gap report.
- Related prior research: `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` concern historical coverage, **not** source return-kind rights or authenticated finality. No relevant Rejection authority established.
- Reused Learning: `LEARN-forward-v02-candidate-return-population-special-payout-20261031`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-v02-excluded-settlement-evaluability-20261024`.
- The contract checks a **declaration only**. It does not prove that any issuer exists, the evidence is complete, the source has rights, corrections are authentic, the terminal state is final, or a ticket was accurately classified. The only allowed result for a structurally complete candidate remains `candidateComplete=true, scoringAuthorized=false`.

## Learning gate

- `fingerprintKey=research-k3.forward-v02.candidate-terminal-return-kind-evidence-requirement-omission`
- `attemptSignature=pr2286-v488-require-independent-exact-ticket-return-kind-and-revision-evidence`
- `environmentKey=github-actions-ubuntu-node24-synthetic/research-only`
- `materialStateKey=outcome-ledger-0.1-no-return-kind+forward-v02-candidate-evidence-four-fields-a48a733f`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. This is a distinct structural requirement, not a retry of a known failing method. **Verification pending formal exact-HEAD CI at report creation; no VERIFIED_SUCCESS Learning claimed yet.**

## Falsification and next gate

The change is falsified if an omitted or inferred terminal return kind can still produce `candidateComplete=true`, or if `scoringAuthorized` can become true. CI must execute the new negative tests and governance checks before classifying a reusable success. Later, independent issuer, rights, exact-ticket settlement revisions, frozen prospective cohort and approved evaluation protocol are still required; a caller-provided declaration cannot satisfy them.

**Isolation:** No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, private raw T-5 odds, private paths, or protected N2 was touched. PR remains Draft and not merge-ready.
