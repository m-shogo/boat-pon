import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION,
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidence,
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function resign(evidence: RuntimeDecisionLedgerShadowEvidence): void {
  const { generatedAt: _generatedAt, contentDigest: _contentDigest, ...digestable } = evidence;
  evidence.contentDigest = sha256(digestable);
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

test("validator rejects rehashed semantic verdict, completeness and safety drift", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  evidence.verdict = "PASS";
  evidence.completeness.mappedRate = 1;
  (evidence.safety as { publicWrites: number }).publicWrites = 1;
  (evidence.privacy as { rawRecordsIncluded: boolean }).rawRecordsIncluded = true;
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("verdict must be CONDITIONAL"));
  assert.ok(validation.errors.includes("completeness.mappedRate mismatch"));
  assert.ok(validation.errors.includes("safety.publicWrites must be 0"));
  assert.ok(validation.errors.includes("privacy.rawRecordsIncluded must be false"));
});

test("validator rejects rehashed unbounded or unsafe count evidence", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  evidence.scope.limit = 5001;
  evidence.scope.bounded = false as true;
  evidence.reconciliation.sourceRows = Number.MAX_SAFE_INTEGER + 1;
  evidence.scope.returnedRows = Number.MAX_SAFE_INTEGER + 1;
  evidence.reconciliation.mappedUnique = Number.MAX_SAFE_INTEGER + 1;
  evidence.reconciliation.unresolvedCount = 0;
  evidence.completeness.mappedRate = 1;
  evidence.completeness.unresolvedRate = 0;
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("sourceRows must be a non-negative safe integer"));
  assert.ok(validation.errors.includes("mappedUnique must be a non-negative safe integer"));
  assert.ok(validation.errors.includes("scope.limit must be an integer between 1 and 5000"));
  assert.ok(validation.errors.includes("scope.bounded must be true"));
});

test("validator binds source descriptor digest to the persisted descriptor", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  evidence.source.fileSizeBytes += 1;
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("sourceDescriptorDigest mismatch"));
});

test("validator rejects non-canonical generatedAt even though it is outside contentDigest", () => {
  for (const generatedAt of ["2026-08-05T17:10:00+09:00", "2026-08-05T24:00:00.000Z"]) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input({ generatedAt }));
    const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.includes("generatedAt must be a canonical UTC date-time"));
  }
});

test("validator rejects rehashed impossible source descriptor values", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  evidence.source.fileSizeBytes = -1;
  evidence.source.pageSizeBytes = 0;
  evidence.source.modifiedTimeMs = Number.POSITIVE_INFINITY;
  evidence.source.journalMode = "";
  evidence.sourceDescriptorDigest = sha256(evidence.source);
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("source.fileSizeBytes must be a non-negative safe integer"));
  assert.ok(validation.errors.includes("source.pageSizeBytes must be a positive safe integer"));
  assert.ok(validation.errors.includes("source.modifiedTimeMs must be a non-negative finite number"));
  assert.ok(validation.errors.includes("source.journalMode must be a non-empty string"));
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
