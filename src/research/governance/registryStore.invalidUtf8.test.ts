import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CONTRACT_DIGEST_VERSION, contractDigest } from "./contracts";
import { listRecords, validateAllRegistries } from "./registryStore";

const experiment = {
  experimentId: "EXP-0001",
  researchQuestion: "q",
  rationale: "r\uFFFDx",
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

function writeDigestValidInvalidUtf8Record(root: string): void {
  const experiments = join(root, "experiments");
  mkdirSync(experiments, { recursive: true });
  const stored = {
    ...experiment,
    _digest: contractDigest(experiment),
    _digestVersion: CONTRACT_DIGEST_VERSION,
    _recordedAt: "2026-08-05T00:00:00.000Z",
  };
  const encoded = Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, "utf8");
  const replacement = Buffer.from("\uFFFD", "utf8");
  const replacementOffset = encoded.indexOf(replacement);
  assert.notEqual(replacementOffset, -1);
  const invalidUtf8 = Buffer.concat([
    encoded.subarray(0, replacementOffset),
    Buffer.from([0xff]),
    encoded.subarray(replacementOffset + replacement.length),
  ]);
  writeFileSync(join(experiments, "EXP-0001.json"), invalidUtf8);
}

test("registry reads reject digest-valid records whose raw bytes are invalid UTF-8", () => {
  const root = mkdtempSync(join(tmpdir(), "reg-invalid-utf8-"));
  writeDigestValidInvalidUtf8Record(root);

  assert.throws(
    () => listRecords(root, "experiments"),
    /registry record invalid utf8/u,
  );

  const audit = validateAllRegistries(root);
  assert.equal(audit.ok, false);
  assert.ok(audit.problems.some((problem) =>
    problem.file === "EXP-0001.json"
    && problem.errors.some((error) => error.includes("registry record invalid utf8"))));
});
