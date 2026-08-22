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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
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

function resign(evidence: RuntimeDecisionLedgerShadowEvidence): void {
  const { generatedAt: _generatedAt, contentDigest: _contentDigest, ...digestable } = evidence;
  evidence.contentDigest = sha256(digestable);
}

test("validator rejects rehashed unknown nested fields", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  const source = evidence.source as unknown as Record<string, unknown>;
  source.privateMetadata = "not-allowed-in-sanitized-evidence";
  evidence.sourceDescriptorDigest = sha256(source);
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("unknown field: source.privateMetadata"));
});

test("validator returns fail-closed errors for malformed nested objects", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input()) as unknown as Record<string, unknown>;
  evidence.source = null;

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("source must be an object"));
});
