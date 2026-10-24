import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION,
  forwardVaultDigest,
  resultMatchesProtocol,
  validateForwardVaultRecord,
  type EvaluationProtocol,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

const digest = "a".repeat(64);
const protocol: EvaluationProtocol = {
  schemaVersion: FORWARD_EVALUATION_VAULT_SCHEMA_VERSION,
  kind: "EVALUATION_PROTOCOL",
  recordId: "metric-protocol:1",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-09-24T09:00:00Z",
  evaluationProtocolId: "metric-eval:1",
  comparisonMode: "COMMON_COHORT",
  oddsBasis: "BUY_TIME",
  metricFamilies: ["ROI"],
  unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["CURRENT_BUY"],
  protocolVersion: "fixture-v1",
};
const result: EvaluationResult = {
  schemaVersion: FORWARD_EVALUATION_VAULT_SCHEMA_VERSION,
  kind: "RESULT",
  recordId: "metric-result:1",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-09-24T11:00:00Z",
  resultId: "metric-result:1",
  analysisSnapshotId: "metric-snapshot:1",
  analysisSnapshotDigest: digest,
  evaluationProtocolId: protocol.evaluationProtocolId,
  evaluationProtocolDigest: forwardVaultDigest(protocol),
  decisionSystem: "research-fixture",
  comparisonMode: protocol.comparisonMode,
  oddsBasis: protocol.oddsBasis,
  metricFamily: "ROI",
  includedCount: 1,
  excludedCount: 0,
  metrics: { roi: 0.5 },
  sourceManifestDigest: digest,
  evaluatorVersion: "fixture-v1",
};

test("result metric family must be authorized by the frozen evaluation protocol", () => {
  assert.equal(validateForwardVaultRecord(protocol).valid, true);
  assert.equal(validateForwardVaultRecord(result).valid, true);
  assert.equal(resultMatchesProtocol(result, protocol), true);

  const unapproved: EvaluationResult = { ...result, metricFamily: "LOGLOSS", metrics: { logloss: 0.4 } };
  assert.equal(validateForwardVaultRecord(unapproved).valid, true);
  assert.equal(resultMatchesProtocol(unapproved, protocol), false);

  const expanded: EvaluationProtocol = { ...protocol, metricFamilies: ["ROI", "LOGLOSS"] };
  assert.equal(resultMatchesProtocol({
    ...unapproved,
    evaluationProtocolDigest: forwardVaultDigest(expanded),
  }, expanded), true);
  assert.equal(resultMatchesProtocol(unapproved, expanded), false);
});
