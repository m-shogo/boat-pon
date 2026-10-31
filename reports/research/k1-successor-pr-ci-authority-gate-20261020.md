# K1 Successor — PR/CI Authority Gate (2026-10-20)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Scope: research-only governance finding; no production authority  
Evidence stage: GitHub source/metadata inspection (not a repository test run)

## Question and hypothesis

Can the existing research PR safely validate the K1 Runtime Decision Ledger successor changes without changing production behavior or consuming protected N2 runs?

Hypothesis: a fast-forward-only attachment of the successor to the existing PR, followed by PR CI, would exercise the four descendant commits under the canonical repository checks. This hypothesis is **not yet verified**.

## Immutable authority snapshot

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Sole open PR: `#2286`, head `research/forward-vault-atomic-readback` at `921a0c590642a79df141600f1b79204a2ed7fa65`.
- Research successor: `research/k1-schema-parity-successor-20261020` at `a237c979113b6b3c32b530d36b45586ce8866957`.
- GitHub compare: successor is **4 commits ahead / 0 behind** PR head, changing seven paths: K1 runtime, schema, four test files and one append-only LEARN record.
- Existing PR CI: run `39220879882`, `verify=success`, `research-governance=success`, but this run verified **only** `921a0c590642`.
- Successor: zero check runs observed for `a237c979113b`; **no official CI success may be claimed**.
- Canonical `.github/workflows/ci.yml` triggers on `push: main` and `pull_request`, not ordinary pushes to this successor branch.
- Recent GitHub Actions schedule state includes pending/queued protected N2 workflows. They were **not activated, rerun, cancelled or modified** for this audit.
- Repository rulesets query returned an empty list; branch-protection inspection returned integration 403. **This does not establish that the PR branch is unprotected.**

## Distinct attachment method tested

Prior attempts to move the existing PR branch using GitHub write endpoints had been rejected; read-back had shown no attachment. This run attempted a distinct, non-force `create_branch` request with the **already-existing PR branch name** and the descendant SHA. GitHub returned **422 Reference already exists**. That is the expected create-ref semantics, **not evidence of a runner failure, CI failure or changed branch permissions**.

Immediate read-back confirmed the existing PR head and open PR count were unchanged. Do not retry `create_branch` with that existing ref under unchanged authority. Do not treat a new successor commit or unrelated main movement as permission to repeat an unchanged blocked branch update.

## Research / process / workflow / platform separation

- Research payload: K1 successor source and synthetic tests exist in a separate branch; their full repository verification remains **unobserved**.
- Process: the attempted Git refs creation failed with HTTP 422, before a CI job or research test was started.
- Workflow: the latest CI green result applies to the older PR head only. No red successor workflow exists to diagnose.
- Post-job infrastructure: not applicable to the 422 write; the prior green PR jobs completed post-steps successfully.
- Runner/platform: no new conclusion. Protected N2 queue state is observed metadata only, not a diagnostic resource.

## Admission and next safe action

1. Re-read latest main, PR head, open PR count, successor SHA, CI, and the Learning gate before any write.
2. Use an **authorized, verified non-force fast-forward branch update** or a materially distinct approved PR-attachment mechanism only when its write authority is established. The prior blocked method must not be repeated unchanged.
3. After successful read-back attachment, require `verify` and `research-governance` on the **new PR head**, then inspect all failing job logs by research payload / process exit / workflow conclusion / post-job / runner layers.
4. Keep `DO_NOT_MERGE_CANDIDATE` until official payout authenticity, refund/invalidation contract and independent research evidence gates are independently resolved. Do not invent readiness counts.
5. Never connect to Current BUY, LINE, automated betting, public publishing, production settings or protected N2 diagnostics.

## Learning gate and retention

- `fingerprintKey`: `research-k3.github-pr-successor-attachment`
- `attemptSignature`: `create-branch-existing-pr-ref-from-verified-descendant`
- `environmentKey`: `github-connector/rest-git-refs`
- `materialStateKey`: `pr-head-921a0c/successor-a237c979/ref-already-exists`
- Gate: `SWITCH_METHOD` (distinct from prior rejected branch-update methods), then `BLOCK_UNCHANGED_RETRY` for this 422 create-ref attempt.
- Reused: `LEARN-github-write-readback-20260918`.
- Classification: `NO_NEW_LEARNING`. HTTP 422 for an existing ref is ordinary API behavior, not a novel root-cause class; no filler `LEARN-*` record is warranted.
- Durable output: this append-only governance finding, with GitHub evidence references only.

Evidence: `pull/2286`; `actions/runs/39220879882`; `compare/921a0c590642...a237c979113b`; `docs/architecture/research-learning-loop.md`; `docs/architecture/research-knowledge-retention-contract.md`; `docs/architecture/runtime-decision-ledger-contract.md`.

No private raw odds, secret, race-specific private values or local private paths were accessed or recorded.
