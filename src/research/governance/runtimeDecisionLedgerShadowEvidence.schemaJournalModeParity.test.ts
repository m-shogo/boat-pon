import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// The schema is also consumed without JSON Schema format assertions. Keep
// journalMode admission aligned with the runtime's ECMAScript trim semantics.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as { properties: { source: { properties: { journalMode: {
  type: string; minLength: number; pattern?: string;
} } } } };
const rule = schema.properties.source.properties.journalMode;
const whitespace = [
  ...Array.from({ length: 5 }, (_, index) => index + 9),
  0x20, 0xA0, 0x1680,
  ...Array.from({ length: 11 }, (_, index) => index + 0x2000),
  0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const probes = [
  "", "wal", " WAL ", " ", "\t\n", "\uFEFF", "\u0085",
  "\uFEFF\u0085", "\u0085\uFEFF", "\uFEFFwal\uFEFF",
  ...whitespace.map((point) => String.fromCodePoint(point)),
  ...[0x85, 0x180E, 0x200B, 0x61, 0x30, 0x1F600].map((point) => String.fromCodePoint(point)),
];

function fixture(journalMode: string): RuntimeDecisionLedgerShadowEvidenceInput {
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
      journalMode,
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
      returnedRows: 2,
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
      sourceRows: 2,
      mappedUnique: 1,
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

test("shadow journalMode schema rejects whitespace-only values without format assertions", () => {
  assert.equal(rule.type, "string");
  assert.equal(rule.minLength, 1);
  assert.equal(typeof rule.pattern, "string");
  const lexical = new RegExp(rule.pattern!, "u");
  for (const value of probes) {
    const expected = value.trim().length > 0;
    assert.equal(lexical.test(value), expected, JSON.stringify(value));
  }
  // Generic \S is not portable between Python and ECMAScript for these code points.
  assert.equal("\uFEFF".trim().length, 0);
  assert.equal("\u0085".trim().length, 1);
});

test("shadow journalMode schema nonblank admission matches runtime validator", () => {
  const lexical = new RegExp(rule.pattern!, "u");
  for (const value of probes) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(fixture(value));
    const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    const expected = value.trim().length > 0;
    assert.equal(lexical.test(value), expected, JSON.stringify(value));
    assert.equal(result.valid, expected, JSON.stringify(value) + ": " + result.errors.join("; "));
  }
});
