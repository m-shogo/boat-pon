import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// These bounded-scope identifiers are trim-canonical, not merely nonblank.
// JSON Schema regexes must agree with ECMAScript trim in Python/Node consumers,
// including U+FEFF, U+0085 and final-newline anchor behavior.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as { properties: { scope: { properties: Record<string, { type: string; minLength: number; pattern: string }> } } };

const whitespace = [
  ...Array.from({ length: 5 }, (_, index) => index + 9),
  0x20, 0xA0, 0x1680,
  ...Array.from({ length: 11 }, (_, index) => index + 0x2000),
  0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const probes = [
  "", "paper-live", "v4-conservative", "A B", "A\nB", "A\uFEFFB",
  " ", "\t\n", "\uFEFF", "\u0085", "\uFEFFA", "A\uFEFF",
  "A\u0085", "\u0085A", "A\n", "A\r", "A\r\n", "A\nB\n",
  "\nA", "A ", " A", "\u200B", "\u180E", "\u2028",
  ...whitespace.map((point) => String.fromCodePoint(point)),
  ...whitespace.map((point) => "A" + String.fromCodePoint(point)),
  ...whitespace.map((point) => String.fromCodePoint(point) + "A"),
];

function fixture(): RuntimeDecisionLedgerShadowEvidenceInput {
  return {
    generatedAt: "2026-08-05T08:10:00.000Z",
    source: {
      fileSizeBytes: 4096,
      modifiedTimeMs: 1_786_000_000_000,
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
      status: "CONDITIONAL",
      sourceRows: 1,
      mappedUnique: 0,
      exactDuplicates: 0,
      unresolvedCount: 1,
      rejectedCount: 0,
      conflictCount: 0,
      recordsDigest: "a".repeat(64),
      records: [],
      unresolved: [{
        sourceDecisionHistoryId: 99,
        reasons: ["close_time_not_proven_visible_at_decision"],
      }],
      rejected: [],
      conflicts: [],
    },
  };
}

for (const field of ["runKind", "modelVersion"] as const) {
  test("shadow scope." + field + " schema matches trim-canonical runtime admission", () => {
    const rule = schema.properties.scope.properties[field];
    assert.equal(rule?.type, "string");
    assert.equal(rule.minLength, 1);
    const regex = new RegExp(rule.pattern, "u");
    for (const value of probes) {
      const expected = value.length > 0 && value.trim() === value;
      const evidence = buildRuntimeDecisionLedgerShadowEvidence({
        ...fixture(),
        scope: { ...fixture().scope, [field]: value },
      });
      const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
      assert.equal(regex.test(value), expected, field + ": " + JSON.stringify(value));
      assert.equal(result.valid, expected, field + ": " + JSON.stringify(value) + ": " + result.errors.join("; "));
    }
  });
}

test("shadow scope canonical schema rules share one cross-engine pattern", () => {
  const rules = schema.properties.scope.properties;
  assert.equal(rules.runKind.pattern, rules.modelVersion.pattern);
  // Do not rely on JS/Python's different \\S whitespace definitions.
  assert.equal(rules.runKind.pattern.includes(String.raw`\\S`), false);
  assert.equal(rules.runKind.pattern.includes(String.raw`\\uFEFF`), true);
  assert.equal(new RegExp(rules.runKind.pattern, "u").test("A\n"), false);
  assert.equal(new RegExp(rules.runKind.pattern, "u").test("A\nB"), true);
});
