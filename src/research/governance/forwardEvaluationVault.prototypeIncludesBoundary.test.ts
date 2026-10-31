import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  forwardVaultDigest,
  resultMatchesProtocol,
  validateForwardVaultRecord,
  type EvaluationProtocol,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Research-only synthetic evidence. Never used for scoring or production.
const protocol = (): EvaluationProtocol => ({
  schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "synthetic-protocol",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T08:00:00Z",
  evaluationProtocolId: "synthetic-eval", comparisonMode: "COMMON_COHORT",
  oddsBasis: "BUY_TIME", metricFamilies: ["ROI"], unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic-system"], protocolVersion: "synthetic-v1",
});
const result = (p: EvaluationProtocol): EvaluationResult => ({
  schemaVersion: V, kind: "RESULT", recordId: "synthetic-result",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T09:00:00Z",
  resultId: "synthetic-result", analysisSnapshotId: "synthetic-snapshot",
  analysisSnapshotDigest: "a".repeat(64), evaluationProtocolId: p.evaluationProtocolId,
  evaluationProtocolDigest: forwardVaultDigest(p), decisionSystem: "synthetic-system",
  comparisonMode: p.comparisonMode, oddsBasis: p.oddsBasis, metricFamily: "ROI",
  includedCount: 1, excludedCount: 0, metrics: { roi: 0 },
  sourceManifestDigest: "b".repeat(64), evaluatorVersion: "synthetic-v1",
});

test("frozen metric admission ignores ambient Array.prototype.includes override", () => {
  const p = protocol(), allowed = result(p);
  const unapproved: EvaluationResult = { ...allowed, metricFamily: "LOGLOSS", metrics: { logloss: 0 } };
  assert.equal(resultMatchesProtocol(allowed, p), true);
  assert.equal(resultMatchesProtocol(unapproved, p), false);
  const original = Array.prototype.includes;
  let observed: boolean;
  try {
    Array.prototype.includes = () => true;
    observed = resultMatchesProtocol(unapproved, p);
  } finally {
    Array.prototype.includes = original;
  }
  assert.equal(observed, false, "ambient includes override must not authorize a new metric");
});

test("vault odds-basis enum validation ignores ambient includes override", () => {
  const p = protocol(), r = result(p);
  const invalidProtocol = { ...p, oddsBasis: "SYNTHETIC_UNKNOWN" };
  const invalidResult = { ...r, oddsBasis: "SYNTHETIC_UNKNOWN" };
  const original = Array.prototype.includes;
  let protocolValid: boolean;
  let resultValid: boolean;
  try {
    Array.prototype.includes = () => true;
    protocolValid = validateForwardVaultRecord(invalidProtocol).valid;
    resultValid = validateForwardVaultRecord(invalidResult).valid;
  } finally {
    Array.prototype.includes = original;
  }
  assert.equal(protocolValid, false);
  assert.equal(resultValid, false);
});
