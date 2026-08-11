import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecordStrict, listRecords } from "./registryStore";

const experiment = {
  experimentId: "EXP-0001",
  researchQuestion: "q",
  rationale: "r",
  hypothesis: "h",
  dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1",
  totalTrialCount: 3,
  testedConditions: 3,
  discoveryPeriod: "..2022",
  validationPeriod: "2022..2024",
  holdoutPolicy: "untouched",
  primaryMetric: "logloss",
  secondaryMetrics: [],
  minimumSample: 100,
  stoppingRule: "n>=100",
  successCondition: "s",
  rejectionCondition: "rj",
  multiplicityFamily: "TF-1",
  evidenceStage: "discovery",
  status: "completed",
  createdAt: "2026-08-05T00:00:00Z",
};

test("registry append and reads reject a symlinked ancestor", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "boat-pon-registry-parent-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-registry-parent-outside-"));
  try {
    symlinkSync(outside, join(sandbox, "research"), "dir");
    const root = join(sandbox, "research", "registries");

    const append = appendRecordStrict(root, "experiments", experiment);
    assert.equal(append.ok, false);
    assert.equal(append.code, "WRITE_FAILED");
    assert.ok(append.errors.some((error) => error.includes("registry ancestor symlink forbidden")));
    assert.equal(existsSync(join(outside, "registries")), false);

    assert.throws(
      () => listRecords(root, "experiments"),
      /registry ancestor symlink forbidden/,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
