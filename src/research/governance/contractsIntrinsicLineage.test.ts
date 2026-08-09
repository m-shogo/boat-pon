import assert from "node:assert/strict";
import test from "node:test";
import { validateDiscovery, validateRejection } from "./contracts";

const discovery = (overrides: Record<string, unknown> = {}) => ({
  discoveryId: "DISC-intrinsic-lineage",
  sourceExperimentIds: ["EXP-parent"],
  sourceStrategyId: null,
  sourceStrategyVersion: null,
  finding: "finding",
  mechanismHypothesis: "mechanism",
  evidenceLevel: "moderate",
  shareClass: "RESEARCH_METHOD",
  scope: "research-only",
  knownConfounders: [],
  trialFamilyId: "TF-intrinsic",
  trialCountAtDiscovery: 1,
  adoptedBy: [],
  rejectedBy: [],
  createdAt: "2026-08-09T00:00:00Z",
  ...overrides,
});

test("discovery strategy provenance is all-or-nothing before append", () => {
  assert.equal(validateDiscovery(discovery()).valid, true);
  assert.equal(validateDiscovery(discovery({ sourceStrategyId: "STRAT-a", sourceStrategyVersion: "v1.0" })).valid, true);
  assert.equal(validateDiscovery(discovery({ sourceStrategyId: "STRAT-a", sourceStrategyVersion: null })).valid, false);
  assert.equal(validateDiscovery(discovery({ sourceStrategyId: null, sourceStrategyVersion: "v1.0" })).valid, false);
  assert.equal(validateDiscovery(discovery({ sourceStrategyId: "EXP-wrong", sourceStrategyVersion: "v1.0" })).valid, false);
});

const rejection = (subjectType: string, subjectId: string) => ({
  rejectionId: "REJ-intrinsic-lineage",
  subjectType,
  subjectId,
  reason: "negative result",
  evidenceStage: "validation",
  trialFamilyId: null,
  createdAt: "2026-08-09T00:00:00Z",
});

test("rejection subject type and id prefix must agree before append", () => {
  assert.equal(validateRejection(rejection("experiment", "EXP-a")).valid, true);
  assert.equal(validateRejection(rejection("discovery", "DISC-a")).valid, true);
  assert.equal(validateRejection(rejection("strategy", "STRAT-a")).valid, true);
  assert.equal(validateRejection(rejection("transfer", "XFER-a")).valid, true);
  assert.equal(validateRejection(rejection("strategy", "EXP-a")).valid, false);
  assert.equal(validateRejection(rejection("transfer", "DISC-a")).valid, false);
  assert.equal(validateRejection(rejection("unknown", "EXP-a")).valid, false);
});
