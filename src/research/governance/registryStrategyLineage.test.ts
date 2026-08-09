import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRecord, checkLineage } from "./registryStore";

function tmp(): string { return mkdtempSync(join(tmpdir(), "reg-lineage-")); }

const experiment = {
  experimentId: "EXP-root", researchQuestion: "q", rationale: "r", hypothesis: "h", dataSnapshot: "ds-v1",
  trialFamilyId: "TF-1", totalTrialCount: 1, testedConditions: 1, discoveryPeriod: "d", validationPeriod: "v",
  holdoutPolicy: "untouched", primaryMetric: "metric", secondaryMetrics: [], minimumSample: 1, stoppingRule: "stop",
  successCondition: "success", rejectionCondition: "reject", multiplicityFamily: "TF-1", evidenceStage: "discovery",
  status: "completed", createdAt: "2026-08-09T00:00:00Z",
};

const family = {
  strategyId: "STRAT-lineage", strategyName: "lineage", coreThesis: "c", mechanismHypothesis: "m",
  parentExperimentIds: ["EXP-root"], knowledgePolicy: "OPEN_COMMONS",
  cleanRoomPolicy: { isolated: false, allowedShareClasses: ["GLOBAL_FACT", "RESEARCH_METHOD"] },
  decisionSystem: "market_intelligence", createdAt: "2026-08-09T00:00:00Z",
};

const version = {
  strategyId: "STRAT-lineage", version: "v1.0", datasetVersion: "d", featureVersion: "f", modelVersion: "m",
  decisionRuleVersion: "dr", ticketSelectorVersion: "ts", changeType: "observation_only", changeReason: "baseline",
  adoptedDiscoveryIds: [], createdAt: "2026-08-09T00:00:00Z",
};

test("strategy family lineage requires every parent experiment", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "strategy-families", { ...family, parentExperimentIds: ["EXP-missing"] });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("strategy family STRAT-lineage references missing experiment EXP-missing")));
});

test("strategy versions require an existing strategy family", () => {
  const root = tmp();
  appendRecord(root, "strategy-versions", version);

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("strategy version STRAT-lineage/v1.0 references missing strategy family STRAT-lineage")));
});

test("strategy family and version lineage passes when parents exist", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", version);

  assert.equal(checkLineage(root).ok, true);
});
