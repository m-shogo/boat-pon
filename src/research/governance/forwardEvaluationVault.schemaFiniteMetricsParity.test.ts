import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault";

// Synthetic RESULT metrics only: schema-only consumers must reject JSON
// exponent overflow just as the research runtime rejects non-finite numbers.
// No scoring, real race evidence, Current BUY or production authority.
type NumericRule = { type: string; minimum: number; maximum: number };
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/forward-evaluation-vault.schema.json", import.meta.url),
  "utf8",
)) as { allOf: Array<{ then?: { properties?: { metrics?: {
  type: string; additionalProperties: NumericRule;
} } } }> };
const metricsRule = schema.allOf[4]?.then?.properties?.metrics;
const numericRule = metricsRule?.additionalProperties;

const fixture = (roi: number): EvaluationResult => ({
  schemaVersion: V,
  kind: "RESULT",
  recordId: "result:synthetic-finite-metric",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-11-03T00:00:00Z",
  resultId: "result:synthetic-finite-metric",
  analysisSnapshotId: "snapshot:synthetic",
  analysisSnapshotDigest: "a".repeat(64),
  evaluationProtocolId: "protocol:synthetic",
  evaluationProtocolDigest: "b".repeat(64),
  decisionSystem: "research-fixture",
  comparisonMode: "COMMON_COHORT",
  oddsBasis: "BUY_TIME",
  metricFamily: "ROI",
  includedCount: 1,
  excludedCount: 0,
  metrics: { roi },
  sourceManifestDigest: "c".repeat(64),
  evaluatorVersion: "synthetic-v1",
});

test("Forward Vault RESULT metric schema bounds both signs of JSON exponent overflow", () => {
  assert.equal(metricsRule?.type, "object");
  assert.equal(numericRule?.type, "number");
  assert.equal(numericRule?.minimum, -Number.MAX_VALUE);
  assert.equal(numericRule?.maximum, Number.MAX_VALUE);
  const overflow = JSON.parse("1e400") as number;
  const negativeOverflow = JSON.parse("-1e400") as number;
  assert.equal(overflow, Infinity);
  assert.equal(negativeOverflow, -Infinity);
  for (const [value, expected] of [
    [0, true],
    [1.2, true],
    [-1.2, true],
    [Number.MAX_VALUE, true],
    [-Number.MAX_VALUE, true],
    [overflow, false],
    [negativeOverflow, false],
  ] as const) {
    const admitted: boolean = value >= numericRule!.minimum && value <= numericRule!.maximum;
    assert.equal(admitted, expected, String(value));
  }
});

test("Forward Vault runtime retains finite metrics and rejects overflow before append", () => {
  for (const value of [0, 1.2, -1.2, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const verdict = validateForwardVaultRecord(fixture(value));
    assert.equal(verdict.valid, true, String(value) + ": " + verdict.errors.join("; "));
  }
  for (const value of [JSON.parse("1e400") as number, JSON.parse("-1e400") as number]) {
    const verdict = validateForwardVaultRecord(fixture(value));
    assert.equal(verdict.valid, false, String(value));
  }
  // JSON Schema cannot distinguish -0 from +0; runtime retains the stricter
  // signed-zero digest guardrail. This is intentionally not full parity.
  assert.equal(validateForwardVaultRecord(fixture(-0)).valid, false);
});
