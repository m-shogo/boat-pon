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

const discovery = {
  discoveryId: "DISC-lineage", sourceExperimentIds: ["EXP-root"], sourceStrategyId: null, sourceStrategyVersion: null,
  finding: "f", mechanismHypothesis: "m", evidenceLevel: "moderate", shareClass: "GLOBAL_FACT", scope: "s",
  knownConfounders: [], trialFamilyId: "TF-1", trialCountAtDiscovery: 1, adoptedBy: [], rejectedBy: [],
  createdAt: "2026-08-09T00:00:00Z",
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

const transfer = {
  transferId: "XFER-lineage", sourceDiscoveryId: "DISC-lineage", targetStrategyId: "STRAT-lineage",
  baseVersion: "v1.0", candidateVersion: "v1.1", historicalComparison: "h", validation: "v",
  untouchedHoldout: "u", shadowForward: "s", calibration: "c", roiLowerBound: null, maxHitRemoval: "m",
  drawdown: "d", coverage: "c", diversityImpact: "d", result: "accepted", createdAt: "2026-08-09T00:00:00Z",
};

const promotion = {
  promotionId: "PROMO-lineage", strategyId: "STRAT-lineage", fromVersion: "v1.0", toState: "candidate",
  transferExperimentIds: ["XFER-lineage"], evidenceDigests: [],
  humanApproval: { approved: false, approver: null, approvedAt: null, note: "not required" },
  productionConnection: false, createdAt: "2026-08-09T00:00:00Z",
};

const rejection = {
  rejectionId: "REJ-lineage", subjectType: "experiment", subjectId: "EXP-root", reason: "negative result",
  evidenceStage: "validation", trialFamilyId: "TF-1", createdAt: "2026-08-09T00:00:00Z",
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

test("strategy versions reject missing adopted discoveries", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", { ...version, adoptedDiscoveryIds: ["DISC-missing"] });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("strategy version STRAT-lineage/v1.0 references missing adopted discovery DISC-missing")));
});

test("strategy versions require accepted transfer before adoption", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", { ...version, adoptedDiscoveryIds: ["DISC-lineage"] });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("strategy version STRAT-lineage/v1.0 adopted DISC-lineage without accepted transfer")));
});

test("discoveries with strategy provenance require an existing source family and version", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", { ...discovery, sourceStrategyId: "STRAT-missing", sourceStrategyVersion: "v9.9" });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("discovery DISC-lineage references missing source strategy family STRAT-missing")));
  assert.ok(lineage.problems.some((problem) => problem.includes("discovery DISC-lineage references missing source strategy version STRAT-missing/v9.9")));
});

test("discovery strategy provenance must provide strategy and version together", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "strategy-families", family);

  assert.throws(
    () => appendRecord(root, "discoveries", { ...discovery, sourceStrategyId: "STRAT-lineage", sourceStrategyVersion: null }),
    /INVALID: sourceStrategyId\/sourceStrategyVersion must both be null or both be set/u,
  );
  assert.throws(
    () => appendRecord(root, "discoveries", { ...discovery, discoveryId: "DISC-version-only", sourceStrategyVersion: "v1.0" }),
    /INVALID: sourceStrategyId\/sourceStrategyVersion must both be null or both be set/u,
  );
});

test("discovery strategy provenance passes when source family and version exist", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", version);
  appendRecord(root, "discoveries", { ...discovery, sourceStrategyId: "STRAT-lineage", sourceStrategyVersion: "v1.0" });

  assert.equal(checkLineage(root).ok, true);
});

test("transfers require an existing target strategy and base version", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "transfer-experiments", transfer);

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("transfer XFER-lineage references missing strategy family STRAT-lineage")));
  assert.ok(lineage.problems.some((problem) => problem.includes("transfer XFER-lineage references missing base strategy version STRAT-lineage/v1.0")));
});

test("promotions require an existing strategy and source version", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "transfer-experiments", transfer);
  appendRecord(root, "promotions", promotion);

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("promotion PROMO-lineage references missing strategy family STRAT-lineage")));
  assert.ok(lineage.problems.some((problem) => problem.includes("promotion PROMO-lineage references missing strategy version STRAT-lineage/v1.0")));
});

test("promotions cannot cite transfer evidence from another strategy", () => {
  const root = tmp();
  const otherFamily = { ...family, strategyId: "STRAT-other", strategyName: "other" };
  const otherVersion = { ...version, strategyId: "STRAT-other" };
  const otherTransfer = { ...transfer, transferId: "XFER-other", targetStrategyId: "STRAT-other" };
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-families", otherFamily);
  appendRecord(root, "strategy-versions", version);
  appendRecord(root, "strategy-versions", otherVersion);
  appendRecord(root, "transfer-experiments", otherTransfer);
  appendRecord(root, "promotions", { ...promotion, transferExperimentIds: ["XFER-other"] });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("promotion PROMO-lineage references transfer XFER-other for different strategy STRAT-other")));
});

test("active research promotions require accepted transfer evidence", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", version);
  appendRecord(root, "transfer-experiments", { ...transfer, result: "pending" });
  appendRecord(root, "promotions", {
    ...promotion,
    toState: "active_research",
    humanApproval: { approved: true, approver: "reviewer", approvedAt: "2026-08-09T00:00:00Z", note: "approved" },
  });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("promotion PROMO-lineage requires accepted transfer XFER-lineage for active_research")));
});

test("rejections require an existing subject of the declared type", () => {
  const root = tmp();
  appendRecord(root, "rejections", { ...rejection, subjectType: "strategy", subjectId: "STRAT-missing" });
  appendRecord(root, "rejections", { ...rejection, rejectionId: "REJ-transfer", subjectType: "transfer", subjectId: "XFER-missing" });

  const lineage = checkLineage(root);
  assert.equal(lineage.ok, false);
  assert.ok(lineage.problems.some((problem) => problem.includes("rejection REJ-lineage references missing strategy STRAT-missing")));
  assert.ok(lineage.problems.some((problem) => problem.includes("rejection REJ-transfer references missing transfer XFER-missing")));
});

test("rejection lineage passes when the declared subject exists", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "rejections", rejection);

  assert.equal(checkLineage(root).ok, true);
});

test("strategy adoption lineage passes after an accepted transfer", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", version);
  appendRecord(root, "transfer-experiments", transfer);
  appendRecord(root, "strategy-versions", { ...version, version: "v1.1", adoptedDiscoveryIds: ["DISC-lineage"] });

  assert.equal(checkLineage(root).ok, true);
});

test("strategy, transfer, and promotion lineage passes when parents exist", () => {
  const root = tmp();
  appendRecord(root, "experiments", experiment);
  appendRecord(root, "discoveries", discovery);
  appendRecord(root, "strategy-families", family);
  appendRecord(root, "strategy-versions", version);
  appendRecord(root, "transfer-experiments", transfer);
  appendRecord(root, "promotions", promotion);

  assert.equal(checkLineage(root).ok, true);
});
