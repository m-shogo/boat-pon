# Forward Vault v0.2 linked-BUY race parity gate (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic preflight. No real evaluation, independent settlement authentication, prospective cohort proof, ROI scoring, promotion or production authority.

## Authority and executable evidence

- Canonical main at inspection: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Existing open research PR: #2286; no second PR created.
- Implementation: `src/research/governance/forwardV02LinkedBuyRaceParity.ts` at commit `d424ca5d1a0ade8ba51be62a90d3327907eb31b6`.
- Synthetic tests: `src/research/governance/forwardV02LinkedBuyRaceParity.test.ts` at commits `3b46ac443d94ff233d8e5ddc3107b9580ce8732d` and `31962ed99004eeafc8df170af592e00b0282b33a`.
- Official PR CI at test HEAD `31962ed99004eeafc8df170af592e00b0282b33a`: Actions run **40043338621**, verify **SUCCESS**, research-governance **SUCCESS**; **4,265 total / 4,263 pass / 2 skip / 0 fail**. All 14 new synthetic test names were observed in the verify job log.
- Scope audit at prior HEAD: main was unchanged; all changed paths were under research/governance/report/registry directories.

## Question and mechanism

Does exact Decision/Outcome/Source Manifest digest linkage prove that the systems being compared observed the **same race population**? No. The v0.2 outcome-link preflight can correctly report content-consistent linked records for system A on one race and system B on another. That is *not* a common race cohort.

The new **deny-only** helper first requires the existing cross-ledger reference and outcome-link preflight, then checks:

1. The unapproved candidate explicitly requests `COMMON_COHORT` with at least two declared benchmark systems.
2. Every linked BUY decision belongs to a declared system, and every declared benchmark system is represented.
3. All linked decisions carry the same `cohortId`.
4. Each system's **set of canonical race IDs** is identical. Different order is allowed, and multiple ticket decisions on one race do not create a spurious race mismatch.
5. Invalid or accessor-backed collections, tampered digest linkage, unsupported stage mapping and a `SELECTED_RACE` protocol cannot pass this gate.

The 14 synthetic regressions cover both aligned and misaligned race sets, missing/undeclared systems, mixed cohort IDs, multi-ticket races, permutation, invalid evidence and the explicit counterexample where the old content-link gate passes but the new race-parity gate rejects.

## Exact boundary: parity is necessary, not sufficient

`linkedBuyRaceSetsAligned: true` means only that **caller-supplied, linked BUY decision race sets** agree under the synthetic contract. It does **not** prove:

- a prospectively frozen cohort, independent timestamp or immutable enrollment/membership authority;
- all predeclared races were represented (including WATCH/SKIP and missing decisions);
- identical eligible denominators, stake exposure, ticket selections or outcome exclusion treatment;
- shared prospectively fixed max-hit removal and equal **retained** race sets;
- independently sourced `EXACT` final settlement or supersession authority;
- an approved v0.2 evaluation protocol or sample adequacy.

All paths return `scoringAuthorized: false`. Even an aligned synthetic fixture retains `UNAPPROVED_PROTOCOL`, `PROSPECTIVE_COHORT_NOT_ATTESTED`, `INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED`, and `ELIGIBLE_DENOMINATORS_AND_EXCLUSIONS_NOT_VERIFIED`.

No Current BUY, LINE, automated betting, public publishing, production settings, Owner Dashboard or protected N2 activation was touched. No private raw odds or private evidence was used.

## Related governance and next action

- `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` from latest main.
- `reports/research/forward-vault-maxhit-cohort-policy-freeze-gate-20261024.md`: prior synthetic event-unit and system-specific exclusion counterexamples.
- `reports/research/forward-v02-outcome-link-preflight-gate-20261024.md`: digest/identity linkage is not independent authority.
- Reused Learning: `LEARN-forward-v02-unmatched-decision-coverage-20261024`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-github-write-readback-20260918`.

Next safe step: add independently verifiable **metadata-only** prospective enrollment and terminal settlement evidence boundaries, including missingness/exclusion and supersession lineage. Do not treat a post-outcome manifest as predecision proof. No live/private/N2 diagnostic run is required or permitted.

## Learning gate

- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This makes the already documented v273/v278 common-cohort ambiguity executable against the v282/v283 cross-ledger preflight; no new failure class or independent real-world success is claimed.
- fingerprintKey: `research-k3.forward-vault.v02-linked-buy-race-set-parity`
- attemptSignature: `pr2286-v284-linked-buy-system-race-parity-deny-only-synthetic-14-fixtures`
- environmentKey: `github-connector/research-pr-node24-ci`
- materialStateKey: `forward-v02-candidate/pr2286-a077530/linked-ledgers-no-cross-system-race-parity`
- Gate: `PROCEED_DISTINCT_SYNTHETIC_PARITY / REUSE_EXISTING_COHORT_AND_READBACK_GUARDRAILS`
- New `LEARN-*`: none. Repeated unchanged failures were not attempted.

**Merge remains blocked** pending independently authenticated enrollment/settlement evidence and reviewed v0.2 evaluation policy, regardless of green CI.
