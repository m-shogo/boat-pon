import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION,
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

function input(overrides: Partial<RuntimeDecisionLedgerShadowEvidenceInput> = {}): RuntimeDecisionLedgerShadowEvidenceInput {
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
      unresolved: [{
        sourceDecisionHistoryId: 99,
        reasons: ["close_time_not_proven_visible_at_decision"],
      }],
      rejected: [],
      conflicts: [],
    },
    ...overrides,
  };
}

test("builds sanitized conditional evidence without row identities", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(evidence.verdict, "CONDITIONAL");
  assert.equal(evidence.completeness.mappedRate, 0.5);
  assert.deepEqual(evidence.completeness.taxonomyCounts, { temporal_provenance: 1 });
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /decision-history:99|sourceDecisionHistoryId|canonicalRaceId|"selection":|1-2-3/);
  assert.equal(evidence.privacy.rawRecordsIncluded, false);
  assert.equal(evidence.safety.operationalDbWrites, 0);
});

test("content digest is stable across generatedAt changes", () => {
  const first = buildRuntimeDecisionLedgerShadowEvidence(input());
  const second = buildRuntimeDecisionLedgerShadowEvidence(input({ generatedAt: "2026-08-05T08:11:00.000Z" }));
  assert.equal(first.contentDigest, second.contentDigest);
});

test("limit reached remains conditional even when every returned row maps", () => {
  const base = input();
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input({
    scope: { ...base.scope, returnedRows: 500, limitReached: true },
    reconciliation: {
      ...base.reconciliation,
      status: "PASS",
      sourceRows: 500,
      mappedUnique: 500,
      unresolvedCount: 0,
      unresolved: [],
    },
  }));
  assert.equal(evidence.verdict, "CONDITIONAL");
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(evidence).valid, true);
});

test("identity conflict fails the evidence verdict", () => {
  const base = input();
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input({
    scope: { ...base.scope, returnedRows: 1 },
    reconciliation: {
      ...base.reconciliation,
      status: "FAILED",
      sourceRows: 1,
      mappedUnique: 0,
      unresolvedCount: 0,
      unresolved: [],
      conflictCount: 1,
      conflicts: [{
        recordId: "private-record-id",
        sourceDecisionHistoryId: 1,
        firstDigest: "b".repeat(64),
        conflictingDigest: "c".repeat(64),
      }],
    },
  }));
  assert.equal(evidence.verdict, "FAILED");
  assert.deepEqual(evidence.completeness.taxonomyCounts, { identity_conflict: 1 });
});

test("validator rejects count mismatch, active WAL and private fields", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input()) as unknown as Record<string, unknown>;
  const reconciliation = evidence.reconciliation as Record<string, unknown>;
  reconciliation.sourceRows = 9;
  const source = evidence.source as Record<string, unknown>;
  source.walPresent = true;
  evidence.records = [{ canonicalRaceId: "2026-08-05-01-01", selection: "1-2-3" }];
  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /unknown top-level field: records/);
});

test("JSON Schema is aligned with the runtime version and privacy constants", () => {
  const schemaUrl = new URL(
    "../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json",
    import.meta.url,
  );
  const schema = JSON.parse(readFileSync(schemaUrl, "utf8")) as Record<string, any>;
  assert.equal(schema.properties.schemaVersion.const, RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION);
  assert.equal(schema.properties.source.properties.walPresent.const, false);
  assert.equal(schema.properties.privacy.properties.rawRecordsIncluded.const, false);
  assert.equal(schema.properties.safety.properties.operationalDbWrites.const, 0);
});
