import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

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

function input(): RuntimeDecisionLedgerShadowEvidenceInput {
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
      unresolved: [{ sourceDecisionHistoryId: 99, reasons: ["close_time_not_proven_visible_at_decision"] }],
      rejected: [],
      conflicts: [],
    },
  };
}

function validateMutatedScope(mutate: (evidence: RuntimeDecisionLedgerShadowEvidence) => void): string[] {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  mutate(evidence);
  resign(evidence);
  return validateRuntimeDecisionLedgerShadowEvidence(evidence).errors;
}

test("validator rejects rehashed impossible or inverted bounded dates", () => {
  const impossible = validateMutatedScope((evidence) => {
    evidence.scope.from = "2026-02-30";
  });
  assert.ok(impossible.includes("bounded scope requires canonical from/to dates"));

  const inverted = validateMutatedScope((evidence) => {
    evidence.scope.from = "2026-08-06";
    evidence.scope.to = "2026-08-05";
  });
  assert.ok(inverted.includes("scope.from must not be after scope.to"));
});

test("validator requires producer-canonical bounded scope identities", () => {
  for (const field of ["runKind", "modelVersion"] as const) {
    const errors = validateMutatedScope((evidence) => {
      evidence.scope[field] = ` ${evidence.scope[field]}`;
    });
    assert.ok(errors.includes(`scope.${field} must be a canonical non-empty string`));
  }

  for (const field of ["from", "to"] as const) {
    const errors = validateMutatedScope((evidence) => {
      evidence.scope[field] = null;
    });
    assert.ok(errors.includes("bounded scope requires canonical from/to dates"));
  }
});
