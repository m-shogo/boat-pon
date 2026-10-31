# Forward Vault: Linux atomic no-replace rename candidate (isolated probe)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: disposable synthetic filesystem/process fixture; official CI outcome tracked separately  
Scope: research-only tests and report; no SDK writer replacement, recovery, production, Owner Dashboard or protected N2 action

## Question and prior authority

Can Linux `renameat2(..., RENAME_NOREPLACE)` eliminate the normal post-hardlink/pre-unlink `nlink=2` readback-denial window while retaining append-only collision refusal? This is a **distinct publication primitive**, not another attempt at the rejected `openSync("wx")`, ordinary `renameSync`, or unsafe orphan-hardlink cleanup.

Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286. The learning gate reuses `LEARN-forward-vault-interrupted-hardlink-readback-20261027` and v370-v376 negative/process/concurrency reports. The main Experiment/Discovery/Rejection lineage covers other research questions; no relevant filesystem-promotion record authorizes this change.

## Protocol

Fixture: `src/research/governance/forwardEvaluationVault.renameNoReplaceLinux.test.ts`, added in `dfbb3f870f3b64dbb4f05cf8c75e9dcb6567bb8d`.

- Create complete synthetic JSON in a fresh disposable directory, `fsync` its staged file, and invoke the **native Linux** `renameat2` with `RENAME_NOREPLACE=1` through a short Python3/glibc child. This is intentionally not Node `renameSync`.
- For a missing destination, require source name removal, exact destination bytes/hash, `nlink=1`, and success from the actual SDK `verifyJsonReadback`; also `fsync` the parent directory.
- For an existing regular file, require `EEXIST`, unchanged destination and still-present staged file. Repeat against an existing symlink and verify that neither the link nor its target was replaced.
- Hold the child immediately **after** successful rename, terminate it with `SIGKILL`, and require complete bytes, no staged name, `nlink=1`, and strict SDK readback.
- Unsupported platform/Python/glibc/kernel/filesystem combinations are explicitly skipped, **not** counted as verified support. The test runs only on Linux with Python3 and a supported syscall.

The local isolated Linux/glibc probe observed successful missing-destination rename (`nlink=1`, staged name absent), `EEXIST` on existing regular and symlink destinations, unchanged existing bytes, and post-rename `SIGKILL` with complete single-link destination. A separate local two-process synthetic race yielded one winner and one `EEXIST` loser; the losing staged file remained. That local race is **not** part of the committed regression and is not an official CI claim.

Reference: Linux man-pages `rename(2)`, https://man7.org/linux/man-pages/man2/rename.2.html (RENAME_NOREPLACE, filesystem support, EEXIST/EXDEV and NFS caveats).

## Interpretation and explicit non-claims

This is a promising **Linux-only candidate**, not a verified drop-in replacement. A successful single rename removes the extra hardlink-name cleanup step that produced the known two-link availability gap. It does not establish power-loss durability, all-filesystem compatibility, malicious parent-directory substitution resistance, external hardlink prevention, cross-mount behavior, or an approved portable Node binding. `fsync` success is not a power-cut test; a process SIGKILL is not a power cut. NFS may report failure after a server-side rename occurred; do not infer a universally definitive failure outcome.

The test uses absolute paths with `AT_FDCWD`; a future design must bind directory identity and examine path substitution/dirfd safety. Failed contenders retain staged names and need separately vetted lifecycle handling; never blindly delete unknown files. No SDK implementation, existing record, production behavior, scoring permission, or readback policy was changed.

## Decision, learning identity, next step

Decision: **research candidate only**. Keep existing SDK and strict fail-closed readback unchanged. Require a supported, reviewed native integration plan; per-filesystem capability checks; anchored directory identity; two-writer/reader races; staged-name failure handling; directory durability and power-loss fault injection before any proposed writer migration.

- `fingerprintKey=research-k3.forward-vault.linux-renameat2-no-replace-single-link-publication`
- `attemptSignature=pr2286-v377-glibc-renameat2-synthetic-publish-collision-postrename-sigkill`
- `environmentKey=github-actions-linux-node24-python3-glibc+local-linux-glibc-probe`
- `materialStateKey=executor-sdk-v3/pr2286-v376-hardlink-publication-and-single-link-readback-v377-native-candidate-probe`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL** from the interrupted-hardlink Learning. New verified success may be retained only after official regression execution and governance checks; otherwise classify conservatively.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, private raw T-5 evidence, or private paths were accessed or modified.
