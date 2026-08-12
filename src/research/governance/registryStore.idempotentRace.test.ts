import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecordIdempotent, appendRecordStrict } from "./registryStore";

const experiment = {
  experimentId: "EXP-RACE", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1", totalTrialCount: 3, testedConditions: 3, discoveryPeriod: "..2022",
  validationPeriod: "2022..2024", holdoutPolicy: "untouched", primaryMetric: "logloss", secondaryMetrics: [],
  minimumSample: 100, stoppingRule: "n>=100", successCondition: "s", rejectionCondition: "rj",
  multiplicityFamily: "TF-1", evidenceStage: "discovery", status: "completed", createdAt: "2026-08-05T00:00:00Z",
};

function tmp(): string { return mkdtempSync(join(tmpdir(), "reg-race-")); }

function hideFinalExistence<T>(path: string, hiddenChecks: number, action: () => T): T {
  const originalExistsSync = fs.existsSync;
  let remaining = hiddenChecks;
  fs.existsSync = ((candidate: fs.PathLike) => {
    if (candidate === path && remaining > 0) {
      remaining -= 1;
      return false;
    }
    return originalExistsSync(candidate);
  }) as typeof fs.existsSync;
  syncBuiltinESMExports();
  try {
    const result = action();
    assert.equal(remaining, 0, "test must exercise every hidden final-path existence check");
    return result;
  } finally {
    fs.existsSync = originalExistsSync;
    syncBuiltinESMExports();
  }
}

test("idempotent append revalidates an identical writer that wins at atomic publication", () => {
  const root = tmp();
  const first = appendRecordStrict(root, "experiments", { ...experiment });
  assert.equal(first.ok, true);
  const before = readFileSync(first.path!, "utf8");

  // Hide the existing final from both pre-publication checks. The hard-link
  // publication then deterministically hits EEXIST, matching the concurrent
  // writer race without timing or retries.
  const retry = hideFinalExistence(first.path!, 2, () =>
    appendRecordIdempotent(root, "experiments", { ...experiment }),
  );

  assert.equal(retry.ok, true);
  assert.equal(retry.code, "ALREADY_RECORDED");
  assert.equal(readFileSync(first.path!, "utf8"), before, "append-only winner must never be overwritten");
});

test("idempotent append fails closed when the concurrent winner has a different body", () => {
  const root = tmp();
  const first = appendRecordStrict(root, "experiments", { ...experiment });
  assert.equal(first.ok, true);
  const before = readFileSync(first.path!, "utf8");

  const retry = hideFinalExistence(first.path!, 2, () =>
    appendRecordIdempotent(root, "experiments", { ...experiment, hypothesis: "different" }),
  );

  assert.equal(retry.ok, false);
  assert.equal(retry.code, "CONFLICT");
  assert.equal(readFileSync(first.path!, "utf8"), before, "conflicting winner must remain immutable");
});
