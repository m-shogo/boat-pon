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

test("shadow evidence rejects rehashed safety drift with a no-op Array.push", () => {
  const good = buildRuntimeDecisionLedgerShadowEvidence(input());
  const bad = buildRuntimeDecisionLedgerShadowEvidence(input());
  (bad.safety as { publicWrites: number }).publicWrites = 1;
  resign(bad);

  const original = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  let observed: { good: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>; bad: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> } | undefined;
  try {
    Object.defineProperty(Array.prototype, "push", {
      configurable: true, writable: true, value() { return this.length; },
    });
    observed = {
      good: validateRuntimeDecisionLedgerShadowEvidence(good),
      bad: validateRuntimeDecisionLedgerShadowEvidence(bad),
    };
  } finally {
    if (original) Object.defineProperty(Array.prototype, "push", original);
    else Reflect.deleteProperty(Array.prototype, "push");
  }

  assert.equal(observed?.good.valid, true);
  assert.equal(observed?.bad.valid, false);
  assert.equal(observed?.bad.evidence, null);
  assert.ok(observed?.bad.errors.includes("safety.publicWrites must be 0"));
});

test("shadow evidence rejects invalid scope with an inherited array index setter", () => {
  const bad = buildRuntimeDecisionLedgerShadowEvidence(input());
  bad.scope.bounded = false as true;
  resign(bad);

  const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let observed: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true, set(_value: unknown) { /* synthetic hostile inherited setter */ },
    });
    observed = validateRuntimeDecisionLedgerShadowEvidence(bad);
  } finally {
    if (original) Object.defineProperty(Array.prototype, "0", original);
    else Reflect.deleteProperty(Array.prototype, "0");
  }

  assert.equal(observed?.valid, false);
  assert.equal(observed?.evidence, null);
  assert.ok(observed?.errors.includes("scope.bounded must be true"));
});

test("shadow evidence rejects nested arrays even with a no-op Array.forEach", () => {
  const bad = buildRuntimeDecisionLedgerShadowEvidence(input());
  (bad.completeness as unknown as Record<string, unknown>).unresolvedReasonCounts = [
    { dbPath: "synthetic-nonprivate-placeholder" },
  ];
  resign(bad);

  const original = Object.getOwnPropertyDescriptor(Array.prototype, "forEach");
  let observed: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(Array.prototype, "forEach", {
      configurable: true, writable: true, value() { return undefined; },
    });
    observed = validateRuntimeDecisionLedgerShadowEvidence(bad);
  } finally {
    if (original) Object.defineProperty(Array.prototype, "forEach", original);
    else Reflect.deleteProperty(Array.prototype, "forEach");
  }

  assert.equal(observed?.valid, false);
  assert.equal(observed?.evidence, null);
  assert.ok(observed?.errors.includes("unexpected array at $.completeness.unresolvedReasonCounts"));
});

test("shadow evidence binds distinct source and content digests under no-op Array.map/sort", () => {
  const firstInput = input();
  const secondInput = input({ source: { ...firstInput.source, fileSizeBytes: 8192 } });
  const baselineFirst = buildRuntimeDecisionLedgerShadowEvidence(firstInput);
  const baselineSecond = buildRuntimeDecisionLedgerShadowEvidence(secondInput);
  assert.notEqual(baselineFirst.sourceDescriptorDigest, baselineSecond.sourceDescriptorDigest);
  assert.notEqual(baselineFirst.contentDigest, baselineSecond.contentDigest);

  const originalMap = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  const originalSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
  let observed: {
    first: RuntimeDecisionLedgerShadowEvidence;
    second: RuntimeDecisionLedgerShadowEvidence;
    validFirst: boolean;
    validSecond: boolean;
  } | undefined;
  try {
    Object.defineProperty(Array.prototype, "map", {
      configurable: true, writable: true, value() { return []; },
    });
    Object.defineProperty(Array.prototype, "sort", {
      configurable: true, writable: true, value() { return this; },
    });
    const first = buildRuntimeDecisionLedgerShadowEvidence(firstInput);
    const second = buildRuntimeDecisionLedgerShadowEvidence(secondInput);
    observed = {
      first, second,
      validFirst: validateRuntimeDecisionLedgerShadowEvidence(first).valid,
      validSecond: validateRuntimeDecisionLedgerShadowEvidence(second).valid,
    };
  } finally {
    Object.defineProperty(Array.prototype, "map", originalMap);
    Object.defineProperty(Array.prototype, "sort", originalSort);
  }

  assert.equal(observed?.validFirst, true);
  assert.equal(observed?.validSecond, true);
  assert.equal(observed?.first.sourceDescriptorDigest, baselineFirst.sourceDescriptorDigest);
  assert.equal(observed?.second.sourceDescriptorDigest, baselineSecond.sourceDescriptorDigest);
  assert.equal(observed?.first.contentDigest, baselineFirst.contentDigest);
  assert.equal(observed?.second.contentDigest, baselineSecond.contentDigest);
  assert.notEqual(observed?.first.contentDigest, observed?.second.contentDigest);
});

test("shadow evidence rejects inherited, hidden, accessor and symbol fields despite matching digests", () => {
  const cases: Array<{
    label: string;
    change: (evidence: RuntimeDecisionLedgerShadowEvidence) => void;
    expected: RegExp;
  }> = [
    {
      label: "inherited nested privacy flag",
      change: (evidence) => {
        const privacy = evidence.privacy as unknown as Record<string, unknown>;
        delete privacy.rawRecordsIncluded;
        Object.setPrototypeOf(privacy, { rawRecordsIncluded: false });
      },
      expected: /missing own enumerable data field: privacy.rawRecordsIncluded/,
    },
    {
      label: "inherited top-level timestamp",
      change: (evidence) => {
        const record = evidence as unknown as Record<string, unknown>;
        const timestamp = record.generatedAt;
        delete record.generatedAt;
        Object.setPrototypeOf(record, { generatedAt: timestamp });
      },
      expected: /missing own enumerable data top-level field: generatedAt/,
    },
    {
      label: "non-enumerable nested privacy flag",
      change: (evidence) => {
        Object.defineProperty(evidence.privacy, "rawRecordsIncluded", {
          value: false, enumerable: false, writable: true, configurable: true,
        });
      },
      expected: /missing own enumerable data field: privacy.rawRecordsIncluded/,
    },
    {
      label: "accessor nested privacy flag",
      change: (evidence) => {
        Object.defineProperty(evidence.privacy, "rawRecordsIncluded", {
          enumerable: true, configurable: true,
          get() { throw new Error("privacy getter must not run"); },
        });
      },
      expected: /missing own enumerable data field: privacy.rawRecordsIncluded/,
    },
    {
      label: "symbol-only extra nested property",
      change: (evidence) => {
        Object.defineProperty(evidence.privacy, Symbol("hidden"), {
          value: "untrusted", enumerable: true, configurable: true,
        });
      },
      expected: /unknown field: privacy.Symbol\(hidden\)/,
    },
  ];

  for (const scenario of cases) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    scenario.change(evidence);
    // Re-sign using the JSON projection that omits inherited/hidden fields.
    // This is a shape-admission test, not a cryptographic forgery claim.
    if (scenario.label !== "accessor nested privacy flag") resign(evidence);
    const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(result.valid, false, scenario.label);
    assert.match(result.errors.join("\n"), scenario.expected, scenario.label);
  }
});
