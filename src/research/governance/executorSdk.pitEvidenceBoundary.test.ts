import assert from "node:assert/strict";
import test from "node:test";
import { runExecutorLifecycle, type ExecutorSpec, type PitEvidence, type SdkContext } from "./executorSdk.js";

const ctx: SdkContext = {
  repoRoot: "/unused-fixture", dataRoot: "/unused-fixture", runId: "pit-boundary-fixture",
  taskId: "research-pit-shape", dryRun: true, writeAllowlist: ["reports/research/"],
};
const evidence = (): PitEvidence => ({
  status: "PASS", validatorId: "fixture-pit", validatorVersion: "v1",
  checkedRecordCount: 1, sameRaceViolationCount: 0, futureViolationCount: 0,
  ambiguousTimingCount: 0, evidencePath: null, evidenceDigest: null,
  notApplicableReason: null,
});
const spec = (pit: PitEvidence): ExecutorSpec => ({
  name: "pit-shape-fixture", safetyLevel: "L0", implemented: true,
  inputContract: () => ({ ok: true, errors: [] }),
  executeReadOnly: () => ({
    outputs: ["reports/research/fixture.json"], digest: "a".repeat(64),
    summary: { fixture: true },
  }),
  pitEvidence: () => pit,
});

test("PIT runtime evidence rejects malformed status and counters before dry-run success", () => {
  const bad: PitEvidence[] = [
    { ...evidence(), status: "UNKNOWN" as PitEvidence["status"] },
    { ...evidence(), checkedRecordCount: -1 },
    { ...evidence(), checkedRecordCount: Number.NaN },
    { ...evidence(), futureViolationCount: Number.NaN },
    { ...evidence(), ambiguousTimingCount: Number.POSITIVE_INFINITY },
    { ...evidence(), sameRaceViolationCount: -1 },
    { ...evidence(), validatorId: "" },
    { ...evidence(), validatorVersion: " " },
    { ...evidence(), status: "NOT_APPLICABLE", notApplicableReason: null },
  ];
  for (const pit of bad) {
    const outcome = runExecutorLifecycle(spec(pit), ctx);
    assert.equal(outcome.result, "BLOCKED", JSON.stringify(pit));
    assert.ok(outcome.blocks.includes("PIT_EVIDENCE_MISSING_OR_INVALID"));
    assert.ok(!outcome.lifecycle.includes("dryRunComplete"));
  }
});

test("PIT PASS and explicit NOT_APPLICABLE preserve existing non-persistent dry-run", () => {
  assert.equal(runExecutorLifecycle(spec(evidence()), ctx).result, "DRY_RUN_OK");
  assert.equal(runExecutorLifecycle(spec({
    ...evidence(), status: "NOT_APPLICABLE",
    checkedRecordCount: 0, notApplicableReason: "no prediction-time feature join",
  }), ctx).result, "DRY_RUN_OK");
});
