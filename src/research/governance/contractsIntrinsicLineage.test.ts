import assert from "node:assert/strict";
import test from "node:test";
import { validateDiscovery } from "./contracts";

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
