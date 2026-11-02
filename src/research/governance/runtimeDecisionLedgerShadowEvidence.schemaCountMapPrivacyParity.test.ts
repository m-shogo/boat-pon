import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// A schema-only Draft 2020-12 consumer must reject private identity fields
// as count-map keys, even if it does not call the runtime validator.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as {
  properties: {
    completeness: { properties: Record<string, { $ref: string }> };
    scope: { properties: Record<string, { allOf?: Array<{ not: { $ref: string } }> }> };
    source: { properties: Record<string, { allOf?: Array<{ not: { $ref: string } }> }> };
  };
  $defs: {
    pathToken: { type: string; pattern: string };
    countMap: {
      type: string;
      propertyNames: { allOf: [{ not: { enum: string[] } }, { not: { $ref: string } }] };
      additionalProperties: { type: string; minimum: number; maximum: number };
    };
  };
};

const forbiddenKeys = [
  "records", "record", "sourceDecisionHistoryId", "decisionId",
  "canonicalRaceId", "raceId", "selection", "dbPath", "localPath",
  "result", "payoutYen", "stakeYen",
] as const;

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function resign(evidence: RuntimeDecisionLedgerShadowEvidence): void {
  const { generatedAt: _generatedAt, contentDigest: _contentDigest, ...digestable } = evidence;
  evidence.contentDigest = createHash("sha256").update(JSON.stringify(canonicalize(digestable))).digest("hex");
}

test("shadow count-map schema propertyNames excludes the runtime private-key denylist", () => {
  const rule = schema.$defs.countMap;
  assert.equal(rule.type, "object");
  assert.deepEqual([...rule.propertyNames.allOf[0]!.not.enum].sort(), [...forbiddenKeys].sort());
  assert.equal(rule.additionalProperties.type, "integer");
  assert.equal(rule.additionalProperties.minimum, 1);
  assert.equal(rule.additionalProperties.maximum, Number.MAX_SAFE_INTEGER);
  for (const field of ["unresolvedReasonCounts", "rejectedReasonCounts", "taxonomyCounts"]) {
    assert.equal(schema.properties.completeness.properties[field]?.$ref, "#/$defs/countMap");
  }
  assert.equal(rule.propertyNames.allOf[0]!.not.enum.includes("close_time_not_proven_visible_at_decision"), false);
  assert.equal(rule.propertyNames.allOf[0]!.not.enum.includes("temporal_provenance"), false);
});

test("shadow runtime rejects re-digested private count-map keys while ordinary keys remain valid", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(fixture());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  for (const key of forbiddenKeys) {
    const forged = structuredClone(baseline);
    Object.defineProperty(forged.completeness.unresolvedReasonCounts, key, {
      value: 1, enumerable: true, writable: true, configurable: true,
    });
    resign(forged);
    const result = validateRuntimeDecisionLedgerShadowEvidence(forged);
    assert.equal(result.valid, false, key);
    assert.ok(
      result.errors.some((error) => error.includes("contains forbidden reason key")),
      key + ": " + result.errors.join("; "),
    );
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});

test("shadow count-map schema path-token propertyNames agrees with runtime on synthetic keys", () => {
  const rule = schema.$defs.countMap;
  assert.equal(rule.propertyNames.allOf.length, 2);
  assert.equal(rule.propertyNames.allOf[1]!.not.$ref, "#/$defs/pathToken");
  const pathPattern = new RegExp(schema.$defs.pathToken.pattern, "u");
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["close_time_not_proven_visible_at_decision", false],
    ["temporal_provenance", false],
    ["note=https://example.invalid/a", false],
    ["https://example.invalid/a", false],
    ["selection", true],
    ["diagnostic=/opt/synthetic-fixture", true],
    ["/synthetic-fixture", true],
    ["C:\\synthetic-fixture", true],
    ["C:/synthetic-fixture", true],
    ["file:///synthetic-fixture", true],
    ["\\\\server\\share", true],
    ["prefix \\\\server\\share", true],
    ["prefix /Users/synthetic-fixture", true],
    ["prefix \\Users\\synthetic-fixture", true],
    ["foo/bar", false],
    ["a//b", false],
    ["A\u0085/opt", false],
    ["A\uFEFF/opt", true],
    ["A\u2028/opt", true],
    ["note=//relative", false],
    ["prefix: /opt", true],
    ["prefix=/opt", true],
    ["prefix:\u0085/opt", false],
  ];

  const baseline = buildRuntimeDecisionLedgerShadowEvidence(fixture());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  for (const [key, expectedDenied] of cases) {
    const schemaDenied = rule.propertyNames.allOf[0]!.not.enum.includes(key) || pathPattern.test(key);
    const forged = structuredClone(baseline);
    Object.defineProperty(forged.completeness.unresolvedReasonCounts, key, {
      value: 1, enumerable: true, writable: true, configurable: true,
    });
    resign(forged);
    const result = validateRuntimeDecisionLedgerShadowEvidence(forged);
    const runtimeDenied = result.errors.some((error) => error.includes("contains forbidden reason key"));
    assert.equal(schemaDenied, expectedDenied, "schema " + JSON.stringify(key));
    assert.equal(runtimeDenied, expectedDenied, "runtime " + JSON.stringify(key));
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});

test("shadow scalar path-token schema matches runtime privacy rejection on synthetic strings", () => {
  const pathPattern = new RegExp(schema.$defs.pathToken.pattern, "u");
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["paper-live", false],
    ["v4-conservative", false],
    ["wal", false],
    ["note=https://example.invalid/a", false],
    ["https://example.invalid/a", false],
    ["foo/bar", false],
    ["A\u0085/opt", false],
    ["prefix:\u0085/opt", false],
    ["diag=/opt/synthetic-fixture", true],
    ["/synthetic-fixture", true],
    ["C:\\synthetic-fixture", true],
    ["C:/synthetic-fixture", true],
    ["file:///synthetic-fixture", true],
    ["\\\\server\\share", true],
    ["prefix /Users/synthetic-fixture", true],
    ["prefix \\Users\\synthetic-fixture", true],
    ["A\uFEFF/opt", true],
    ["A\u2028/opt", true],
    ["prefix: /opt", true],
    ["prefix=/opt", true],
  ];
  for (const field of ["runKind", "modelVersion", "journalMode"] as const) {
    const rule = field === "journalMode"
      ? schema.properties.source.properties[field]
      : schema.properties.scope.properties[field];
    assert.equal(rule?.allOf?.[0]?.not.$ref, "#/$defs/pathToken", field);
    for (const [value, expectedDenied] of cases) {
      assert.equal(pathPattern.test(value), expectedDenied, "schema " + field + ": " + JSON.stringify(value));
      const input = fixture();
      if (field === "journalMode") input.source.journalMode = value;
      else input.scope[field] = value;
      const result = validateRuntimeDecisionLedgerShadowEvidence(buildRuntimeDecisionLedgerShadowEvidence(input));
      const runtimeDenied = result.errors.some((error) => error.includes("absolute path-like value"));
      assert.equal(runtimeDenied, expectedDenied, "runtime " + field + ": " + JSON.stringify(value));
      assert.equal(result.valid, !expectedDenied, field + ": " + JSON.stringify(value) + ": " + result.errors.join("; "));
    }
  }
});
