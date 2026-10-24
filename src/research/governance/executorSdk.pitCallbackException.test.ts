import assert from "node:assert/strict";
import test from "node:test";
import { runExecutorLifecycle, type ExecutorSpec, type SdkContext } from "./executorSdk.js";

const ctx: SdkContext = {
  repoRoot: "/unused-fixture", dataRoot: "/unused-fixture", runId: "pit-callback-fixture",
  taskId: "research-pit-callback", dryRun: true, writeAllowlist: ["reports/research/"],
};
const base = (): ExecutorSpec => ({
  name: "pit-callback-fixture", safetyLevel: "L0", implemented: true,
  inputContract: () => ({ ok: true, errors: [] }),
  executeReadOnly: () => ({
    outputs: ["reports/research/fixture.json"], digest: "a".repeat(64),
    summary: { fixture: true },
  }),
});
test("PIT callback exceptions return typed FAILED without leaking error text", () => {
  const sentinel = "private-validation-error-sentinel";
  const cases: ExecutorSpec[] = [
    { ...base(), pitEvidence: () => { throw new Error(sentinel); } },
    { ...base(), pitGuarantee: () => { throw new Error(sentinel); } },
  ];
  for (const candidate of cases) {
    const outcome = runExecutorLifecycle(candidate, ctx);
    assert.equal(outcome.result, "FAILED");
    assert.deepEqual(outcome.blocks, ["PIT_EVIDENCE_VALIDATOR_EXCEPTION"]);
    assert.equal(JSON.stringify(outcome).includes(sentinel), false);
    assert.equal(outcome.lifecycle.includes("dryRunComplete"), false);
  }
});
test("valid PIT evidence preserves nonpersistent DRY_RUN_OK", () => {
  const outcome = runExecutorLifecycle({
    ...base(),
    pitEvidence: () => ({
      status: "PASS", validatorId: "fixture", validatorVersion: "v1",
      checkedRecordCount: 1, sameRaceViolationCount: 0,
      futureViolationCount: 0, ambiguousTimingCount: 0,
      evidencePath: null, evidenceDigest: null, notApplicableReason: null,
    }),
  }, ctx);
  assert.equal(outcome.result, "DRY_RUN_OK");
  assert.equal(outcome.lifecycle.includes("dryRunComplete"), true);
});
