# Forward Vault FD-lifetime CI triage: embedded Python bytes literal newline escape

Status: **TEST FIXTURE FAILURE / CORRECTED; LATEST-HEAD CI PENDING**  
Date: 2026-10-28 JST  
Scope: research-only synthetic test source; no production, evidence authority or SDK behavior change.

## Authority and repeat gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open PR: [#2286](https://github.com/m-shogo/boat-pon/pull/2286). Read latest-main research learning and retention contracts plus related directory-FD and stdout-framing Learning. The existing stdout-framing lesson addresses incomplete child output, **not** a Python syntax error before test execution.

- fingerprintKey: `research-k3.forward-vault.embedded-python-newline-escape-fixture`
- attemptSignature: `pr2286-v390-inline-python-bytes-literal-single-escaped-newline`
- environmentKey: `github-actions-linux-node24-typescript6.0.3+local-linux-node22-python3`
- materialStateKey: `pr2286-v390-dirfd-lifetime-test-embedded-python-source`
- Learning gate: **SWITCH_METHOD / REUSE_GUARDRAIL**. Do not rerun the unchanged one-backslash TypeScript fixture. Fix the source escaping and validate the actual child program.

## Full failure-layer attribution

Official [Actions #40527184621](https://github.com/m-shogo/boat-pon/actions/runs/40527184621) ran the latest Learning-bearing test head `c306512bea0f6f0a7e59bab1679888c4c8daa5f5` and concluded **FAILURE** in verify, **SUCCESS** in research-governance.

1. **Research payload:** the Python child never reached the FD-reuse or no-replace assertions. The generated Python source had a literal line break inside a single-quoted `b'...'` bytes literal, raising `SyntaxError: unterminated string literal` at line 33. Both new tests failed for this same fixture reason; no claim about Linux publication safety can be made from this red run.
2. **Process exit:** the test command exited **1**. The complete verify log reported **4,567 PASS / 2 FAIL / 2 SKIP** (4,571 total); both failures were the new fixture.
3. **Workflow:** verify **FAILURE**; research-governance **SUCCESS**, including registry digest, two-strike gate and production isolation.
4. **Post-job:** Post Checkout completed successfully. Post Setup .NET and Post Setup Node were skipped in verify after the test failure; no post-job failure was reported.
5. **Runner/platform:** no runner outage or platform fault was evidenced. The Node.js 20 action-deprecation warning is unrelated to the syntax failure.

The test source embedded Python code in TypeScript double-quoted strings. A single TypeScript `
` sequence became an actual newline **inside the Python source**. The local pre-commit test had the required doubled source backslashes; the GitHub-created file lost one backslash in each of two bytes-literal branches. This is a source transfer/fixture parity error, not a kernel, FD lifetime, or production failure.

## Correction and verification contract

Commit `6fe6ab4ad1861408c3ac3c75350de377a17eb78f` changes only the two embedded Python bytes-literal newline sequences from a one-backslash TypeScript escape to a two-backslash TypeScript source escape. It restores the intended Python `b'...
'` syntax. No test assertions, SDK implementation, registry record or production behavior changed.

Local Linux Node 22/Python 3.13 execution of the corrected 2-test fixture: **2 PASS / 0 FAIL**. The corrected GitHub file was read back and its two newline sequences verified. [Fix CI #40527910256](https://github.com/m-shogo/boat-pon/actions/runs/40527910256) was queued when this report was created; do not claim official green until its complete verify and governance jobs finish.

**Reusable guardrail:** for embedded Python (or other generated child source), verify the **post-escape child program** and compare the exact GitHub-read-back file with the locally executed fixture. Preserve a dedicated syntax smoke test or a fixed byte-level fixture before running the full CI. A green local test of a different source string is not a verification of the committed artifact.

No Current BUY, LINE, publishing, automated betting, protected N2, Owner Dashboard, private raw odds/paths, or production settings changed. The distinct FD-number-reuse research finding still requires a green committed-fixture CI before it is called officially verified.
