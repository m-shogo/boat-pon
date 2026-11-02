import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// A syntactically valid JSON exponent can overflow JavaScript Number to Infinity.
// Draft 2020-12 consumers must not admit it when runtime requires finite mtime.
// This is schema/runtime metadata parity, not an authenticated file timestamp.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as { properties: { source: { properties: { modifiedTimeMs: {
  type: string; minimum: number; maximum?: number;
} } } } };
const rule = schema.properties.source.properties.modifiedTimeMs;

function fixture(modifiedTimeMs: number): RuntimeDecisionLedgerShadowEvidenceInput {
  return {
    generatedAt: "2026-08-05T08:10:00.000Z",
    source: {
      fileSizeBytes: 4096,
      modifiedTimeMs,
      sqliteSchemaVersion: 42,
      sqliteUserVersion: 0,
      pageCount: 1,
      pageSizeBytes: 4096,
      freelistCount: 0,
      journalMode: "wal",
      walPresent: false,
      readOnly: true,
      queryOnly: true,
    },
    scope: {
      runKind: "paper-live",
      modelVersion: "v4-conservative",
      from: "2026-01-01",
      to: "2026-08-05",
      limit: 500,
      returnedRows: 1,
      limitReached: false,
      bounded: true,
    },
    context: {
      decisionSystem: "decision-history-shadow:paper-live",
      strategyVersion: "shadow:v4-conservative:paper-live",
      featureVersion: "decision-audit-v1",
      manifestId: "decision-history-shadow-manifest:test",
      cohortId: "decision-history-shadow-cohort:test",
      evaluationMode: "formal_forward",
      lineNotificationEligible: false,
    },
    reconciliation: {
      status: "PASS",
      sourceRows: 1,
      mappedUnique: 1,
      exactDuplicates: 0,
      unresolvedCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      recordsDigest: "a".repeat(64),
      records: [],
      unresolved: [],
      rejected: [],
      conflicts: [],
    },
  };
}

test("shadow mtime schema bounds finite numeric admission without rejecting finite runtime values", () => {
  assert.equal(rule.type, "number");
  assert.equal(rule.minimum, 0);
  assert.equal(rule.maximum, Number.MAX_VALUE);
  const overflow = JSON.parse("1e400") as number;
  assert.equal(overflow, Number.POSITIVE_INFINITY);
  for (const [value, expected] of [
    [0, true],
    [1_786_000_000_000, true],
    [Number.MAX_VALUE, true],
    [-1, false],
    [overflow, false],
  ] as const) {
    const schemaRangeAdmits: boolean = value >= rule.minimum && value <= rule.maximum!;
    assert.equal(schemaRangeAdmits, expected, String(value));
  }
});

test("shadow runtime rejects overflow mtime and retains valid finite metadata", () => {
  for (const value of [0, 1_786_000_000_000, Number.MAX_VALUE]) {
    const result = validateRuntimeDecisionLedgerShadowEvidence(
      buildRuntimeDecisionLedgerShadowEvidence(fixture(value)),
    );
    assert.equal(result.valid, true, String(value) + ": " + result.errors.join("; "));
  }
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(fixture(1_786_000_000_000));
  const forged = structuredClone(evidence);
  forged.source.modifiedTimeMs = JSON.parse("1e400") as number;
  const result = validateRuntimeDecisionLedgerShadowEvidence(forged);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) =>
    error.includes("source.modifiedTimeMs must be a non-negative finite number")
  ), result.errors.join("; "));
});
