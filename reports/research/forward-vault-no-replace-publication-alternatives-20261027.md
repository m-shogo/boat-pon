# Forward Vault no-replace publication alternatives: synthetic rejection fixtures

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: synthetic research-only filesystem fixtures; **no SDK writer change, no automatic orphan cleanup, no production connection**  
Evidence stage: engineering negative-fixture design; CI execution is tracked separately

## Question and authority

Could replacing the current temporary-file + no-replace hard-link publication with a simpler filesystem primitive remove the orphan-hardlink availability gap without weakening append-only semantics?

Authority: latest canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, PR #2286, `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `LEARN-forward-vault-interrupted-hardlink-readback-20261027`, and the v371/v372 orphan-hardlink, inode-substitution and parent-directory-fsync negative fixtures. The unrelated `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern dataset inventory rather than filesystem publication; no directly matching Rejection was established.

## Bounded candidate tests

New `src/research/governance/forwardEvaluationVault.publicationAlternatives.test.ts` uses disposable OS temporary directories and synthetic JSON only.

1. **Exclusive destination creation (`openSync(path, "wx")`)** refuses a second creator, but the destination name becomes visible before the first writer has completed the JSON. A synthetic reader observes an incomplete document and strict readback refuses it. The failed attempt leaves an existing incomplete name; a subsequent exclusive creator cannot replace it. This is not a real crash trace or proof of durability.
2. **Plain `renameSync(staged, destination)`** atomically changes a pathname but can replace a pre-existing append-only record. In a disposable fixture, a conflicting JSON replaces the original and basic structural readback succeeds, demonstrating why parse-only verification is not an append-only identity check. The actual `atomicWriteJson(..., allowReplace=false)` correctly rejects the conflicting append in the same fixture.

These tests do **not** attempt unsafe cleanup or alter the shared SDK implementation. The current hard-link publication retains its no-replace property, while the known post-link/pre-unlink orphan window remains unresolved.

## Decision and limitations

**Reject both simple substitutions as a safe drop-in recovery design.** Exclusive creation sacrifices atomic visibility; plain rename sacrifices no-replace append-only identity. Do not switch methods solely to remove the known hard-link orphan window. A viable future proposal must specify a filesystem/platform-dependent no-replace atomic-publication primitive, directory durability ordering, namespace threat model, and adversarial cross-writer/restart tests. A successful syscall, ordinary green CI or synthetic fixture does not prove power-loss durability.

No independent witness, settlement finality/correction completeness, trusted clock/revocation, prospective cohort freeze or approved v0.2 evaluation protocol is supplied. No scoring, merge, protected N2 activation, Current BUY, LINE, public publishing, automated betting, production settings or Owner Dashboard change is authorized.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.no-replace-publication-alternative-counterexamples`
- `attemptSignature`: `pr2286-v373-synthetic-exclusive-create-partial-visibility-and-rename-replacement-fixtures`
- `environmentKey`: `github-connector/github-actions-node24-typescript6.0.3`
- `materialStateKey`: `executor-sdk-v3/pr2286-v372-linkSync-unlinkSync-no-replace-single-link-readback`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse `LEARN-forward-vault-interrupted-hardlink-readback-20261027` and v371/v372 negative fixtures; do not retry a filename-only orphan cleanup or claim a safe alternative without stronger evidence.
- Classification: **REUSED_LEARNING** pending official CI verification; these are candidate rejection counterexamples, not an independently observed new failure in the current writer. No new LEARN is justified by a routine synthetic candidate rejection.

Falsification: demonstrate a no-replace, all-or-nothing publication candidate that passes crash-boundary and concurrent namespace substitution tests under a documented platform/filesystem model without relaxing readback or replacing existing evidence.
