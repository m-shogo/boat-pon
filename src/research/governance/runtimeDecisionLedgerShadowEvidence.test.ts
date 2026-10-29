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

test("shadow evidence rejects re-digested reconciliation status/count contradictions", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const falsePass = structuredClone(baseline);
  falsePass.reconciliation.status = "PASS"; // unresolvedCount remains positive
  resign(falsePass);
  const passResult = validateRuntimeDecisionLedgerShadowEvidence(falsePass);
  assert.equal(passResult.valid, false);
  assert.ok(passResult.errors.includes("reconciliation.status must be CONDITIONAL"));

  const falseFailure = structuredClone(baseline);
  falseFailure.reconciliation.status = "FAILED"; // conflictCount remains zero
  falseFailure.verdict = "FAILED";
  resign(falseFailure);
  const failureResult = validateRuntimeDecisionLedgerShadowEvidence(falseFailure);
  assert.equal(failureResult.valid, false);
  assert.ok(failureResult.errors.includes("reconciliation.status must be CONDITIONAL"));
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

test("shadow evidence rejects non-boolean WAL absence claims even with consistent digests", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  for (const claim of [0, "", null, undefined, true]) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    (evidence.source as unknown as Record<string, unknown>).walPresent = claim;
    evidence.sourceDescriptorDigest = sha256(evidence.source);
    resign(evidence);
    const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(result.valid, false, `walPresent=${String(claim)}`);
    assert.equal(result.evidence, null);
    // Undefined is rejected by the earlier non-JSON graph preflight; the other
    // invalid values still reach the field-specific WAL denial.
    assert.ok(result.errors.includes(claim === undefined
      ? "non-JSON undefined forbidden in evidence graph"
      : "source.walPresent must be false"));
  }

  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
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

test("shadow date admission ignores ambient Date.parse and Date.prototype.toISOString", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const invalidInstant = "2026-08-05T08:10:00+00:00";
  const invalidDay = "2026-02-30";
  const forgedInstant = structuredClone(baseline);
  forgedInstant.generatedAt = invalidInstant;
  const forgedDay = structuredClone(baseline);
  forgedDay.scope.from = invalidDay;
  resign(forgedDay);

  const originalParse = Date.parse;
  const originalIso = Object.getOwnPropertyDescriptor(Date.prototype, "toISOString")!;
  try {
    Date.parse = (value: string) => {
      if (value === invalidInstant) return 0;
      if (value === `${invalidDay}T00:00:00.000Z`) return 1;
      return Reflect.apply(originalParse, Date, [value]) as number;
    };
    Object.defineProperty(Date.prototype, "toISOString", {
      configurable: true, writable: true,
      value(this: Date) {
        if (this.getTime() === 0) return invalidInstant;
        if (this.getTime() === 1) return `${invalidDay}T00:00:00.000Z`;
        return Reflect.apply(originalIso.value, this, []);
      },
    });

    assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
    const instantResult = validateRuntimeDecisionLedgerShadowEvidence(forgedInstant);
    assert.equal(instantResult.valid, false);
    assert.equal(instantResult.evidence, null);
    assert.ok(instantResult.errors.includes("generatedAt must be a canonical UTC date-time"));

    const dayResult = validateRuntimeDecisionLedgerShadowEvidence(forgedDay);
    assert.equal(dayResult.valid, false);
    assert.equal(dayResult.evidence, null);
    assert.ok(dayResult.errors.includes("bounded scope requires canonical from/to dates"));
  } finally {
    Date.parse = originalParse;
    Object.defineProperty(Date.prototype, "toISOString", originalIso);
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});

test("validator rejects rehashed impossible source descriptor values", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  evidence.source.fileSizeBytes = -1;
  evidence.source.pageSizeBytes = 0;
  evidence.source.modifiedTimeMs = -1;
  evidence.source.journalMode = "";
  evidence.sourceDescriptorDigest = sha256(evidence.source);
  resign(evidence);

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("source.fileSizeBytes must be a non-negative safe integer"));
  assert.ok(validation.errors.includes("source.pageSizeBytes must be a positive safe integer"));
  assert.ok(validation.errors.includes("source.modifiedTimeMs must be a non-negative finite number"));
  assert.ok(validation.errors.includes("source.journalMode must be a non-empty string"));

  const nonfinite = buildRuntimeDecisionLedgerShadowEvidence(input());
  nonfinite.source.modifiedTimeMs = Number.POSITIVE_INFINITY;
  nonfinite.sourceDescriptorDigest = sha256(nonfinite.source);
  resign(nonfinite);
  const nonfiniteResult = validateRuntimeDecisionLedgerShadowEvidence(nonfinite);
  assert.equal(nonfiniteResult.valid, false);
  assert.ok(nonfiniteResult.errors.includes("non-finite number forbidden in evidence graph"));
});

test("shadow evidence regex admission is stable under ambient RegExp.prototype.test mutation", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const embeddedPath = structuredClone(baseline);
  embeddedPath.scope.modelVersion = "diagnostic=/opt/synthetic-fixture";
  resign(embeddedPath);

  const invalidHex = structuredClone(baseline);
  invalidHex.contextDigest = "not-a-sha256";
  resign(invalidHex);

  const original = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
  try {
    Object.defineProperty(RegExp.prototype, "test", {
      configurable: true, writable: true, value() { return false; },
    });
    assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
    const pathResult = validateRuntimeDecisionLedgerShadowEvidence(embeddedPath);
    assert.equal(pathResult.valid, false);
    assert.equal(pathResult.evidence, null);
    assert.ok(pathResult.errors.includes("absolute path-like value at $.scope.modelVersion"));

    Object.defineProperty(RegExp.prototype, "test", {
      configurable: true, writable: true, value() { return true; },
    });
    assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
    const digestResult = validateRuntimeDecisionLedgerShadowEvidence(invalidHex);
    assert.equal(digestResult.valid, false);
    assert.equal(digestResult.evidence, null);
    assert.ok(digestResult.errors.includes("contextDigest must be sha256 hex"));
  } finally {
    Object.defineProperty(RegExp.prototype, "test", original);
  }
});

test("shadow evidence ignores ambient RegExp.prototype.exec for path and digest admission", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const embeddedPath = structuredClone(baseline);
  embeddedPath.scope.modelVersion = "diagnostic=/opt/synthetic-fixture";
  resign(embeddedPath);
  const invalidHex = structuredClone(baseline);
  invalidHex.contextDigest = "not-a-sha256";
  resign(invalidHex);

  const original = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")!;
  try {
    Object.defineProperty(RegExp.prototype, "exec", {
      configurable: true, writable: true,
      value(this: RegExp, value: string) {
        if (value === "diagnostic=/opt/synthetic-fixture") return null;
        if (value === "not-a-sha256") return ["synthetic-match"];
        return Reflect.apply(original.value, this, [value]);
      },
    });
    assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
    const pathResult = validateRuntimeDecisionLedgerShadowEvidence(embeddedPath);
    assert.equal(pathResult.valid, false);
    assert.equal(pathResult.evidence, null);
    assert.ok(pathResult.errors.includes("absolute path-like value at $.scope.modelVersion"));

    const digestResult = validateRuntimeDecisionLedgerShadowEvidence(invalidHex);
    assert.equal(digestResult.valid, false);
    assert.equal(digestResult.evidence, null);
    assert.ok(digestResult.errors.includes("contextDigest must be sha256 hex"));
  } finally {
    Object.defineProperty(RegExp.prototype, "exec", original);
  }
});

test("JSON Schema is aligned with the runtime version and privacy constants", () => {
  const schemaUrl = new URL(
    "../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json",
    import.meta.url,
  );
  const schema = JSON.parse(readFileSync(schemaUrl, "utf8")) as Record<string, any>;
  assert.equal(schema.properties.schemaVersion.const, RUNTIME_DECISION_LEDGER_SHADOW_EVIDENCE_SCHEMA_VERSION);
  assert.equal(schema.properties.source.properties.walPresent.const, false);
  assert.equal(schema.$defs.countMap.additionalProperties.minimum, 1);
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
  assert.ok(observed?.errors.includes("completeness.unresolvedReasonCounts must be a count map"));
});

test("shadow evidence preserves distinct canonical digests under empty Object.keys", () => {
  const firstInput = input();
  const secondInput = input({
    source: { ...firstInput.source, fileSizeBytes: firstInput.source.fileSizeBytes + 1 },
  });
  const baselineFirst = buildRuntimeDecisionLedgerShadowEvidence(firstInput);
  const baselineSecond = buildRuntimeDecisionLedgerShadowEvidence(secondInput);
  assert.notEqual(baselineFirst.sourceDescriptorDigest, baselineSecond.sourceDescriptorDigest);

  const original = Object.getOwnPropertyDescriptor(Object, "keys");
  let observed: {
    first: RuntimeDecisionLedgerShadowEvidence;
    second: RuntimeDecisionLedgerShadowEvidence;
    validFirst: boolean;
    validSecond: boolean;
  } | undefined;
  try {
    Object.defineProperty(Object, "keys", {
      configurable: true, writable: true, value() { return []; },
    });
    const first = buildRuntimeDecisionLedgerShadowEvidence(firstInput);
    const second = buildRuntimeDecisionLedgerShadowEvidence(secondInput);
    observed = {
      first, second,
      validFirst: validateRuntimeDecisionLedgerShadowEvidence(first).valid,
      validSecond: validateRuntimeDecisionLedgerShadowEvidence(second).valid,
    };
  } finally {
    if (original) Object.defineProperty(Object, "keys", original);
    else Reflect.deleteProperty(Object, "keys");
  }

  assert.equal(observed?.validFirst, true);
  assert.equal(observed?.validSecond, true);
  assert.equal(observed?.first.sourceDescriptorDigest, baselineFirst.sourceDescriptorDigest);
  assert.equal(observed?.second.sourceDescriptorDigest, baselineSecond.sourceDescriptorDigest);
  assert.equal(observed?.first.contentDigest, baselineFirst.contentDigest);
  assert.equal(observed?.second.contentDigest, baselineSecond.contentDigest);
  assert.notEqual(observed?.first.contentDigest, observed?.second.contentDigest);
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
      expected: /non-plain prototype forbidden in evidence graph/,
    },
    {
      label: "inherited top-level timestamp",
      change: (evidence) => {
        const record = evidence as unknown as Record<string, unknown>;
        const timestamp = record.generatedAt;
        delete record.generatedAt;
        Object.setPrototypeOf(record, { generatedAt: timestamp });
      },
      expected: /non-plain prototype forbidden in evidence graph/,
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

test("shadow evidence rejects rehashed reason-count omissions, invalid values and taxonomy drift", () => {
  const cases: Array<{
    label: string;
    change: (evidence: RuntimeDecisionLedgerShadowEvidence) => void;
    expected: RegExp;
  }> = [
    {
      label: "unresolved rows without any recorded reason",
      change: (evidence) => { evidence.completeness.unresolvedReasonCounts = {}; },
      expected: /unresolvedReasonCounts does not cover unresolved rows/,
    },
    {
      label: "non-integer reason count despite rehashed content",
      change: (evidence) => {
        (evidence.completeness.unresolvedReasonCounts as Record<string, unknown>)
          .close_time_not_proven_visible_at_decision = "1";
      },
      expected: /unresolvedReasonCounts.close_time_not_proven_visible_at_decision must be a non-negative safe integer/,
    },
    {
      label: "taxonomy reclassification despite rehashed content",
      change: (evidence) => { evidence.completeness.taxonomyCounts = { schema_or_value: 1 }; },
      expected: /completeness.taxonomyCounts mismatch/,
    },
    {
      label: "forbidden raw-data key in reason dictionary",
      change: (evidence) => { evidence.completeness.unresolvedReasonCounts = { dbPath: 1 }; },
      expected: /completeness.unresolvedReasonCounts contains forbidden reason key/,
    },
  ];
  for (const scenario of cases) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    scenario.change(evidence);
    resign(evidence);
    const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(validation.valid, false, scenario.label);
    assert.equal(validation.evidence, null, scenario.label);
    assert.match(validation.errors.join("\n"), scenario.expected, scenario.label);
  }
});

test("shadow evidence rejects hidden, symbol, inherited and accessor reason-count properties", () => {
  const cases: Array<{
    label: string;
    change: (evidence: RuntimeDecisionLedgerShadowEvidence) => void;
    expected: RegExp;
  }> = [
    {
      label: "hidden data property",
      change: (evidence) => {
        Object.defineProperty(evidence.completeness.unresolvedReasonCounts, "hidden", {
          value: 1, enumerable: false, configurable: true,
        });
      },
      expected: /unresolvedReasonCounts.hidden must be an own enumerable data field/,
    },
    {
      label: "symbol property",
      change: (evidence) => {
        Object.defineProperty(evidence.completeness.unresolvedReasonCounts, Symbol("hidden"), {
          value: 1, enumerable: true, configurable: true,
        });
      },
      expected: /unresolvedReasonCounts must not contain symbol keys/,
    },
    {
      label: "inherited property",
      change: (evidence) => {
        Object.setPrototypeOf(evidence.completeness.unresolvedReasonCounts, { hidden: 1 });
      },
      expected: /non-plain prototype forbidden in evidence graph/,
    },
    {
      label: "accessor property",
      change: (evidence) => {
        Object.defineProperty(evidence.completeness.unresolvedReasonCounts, "hidden", {
          enumerable: false, configurable: true,
          get() { throw new Error("hidden reason getter must not execute"); },
        });
      },
      expected: /unresolvedReasonCounts.hidden must be an own enumerable data field/,
    },
  ];
  for (const scenario of cases) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    scenario.change(evidence);
    // JSON projection ignores these extra properties; the existing digest still matches.
    const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(validation.valid, false, scenario.label);
    assert.equal(validation.evidence, null, scenario.label);
    assert.match(validation.errors.join("\n"), scenario.expected, scenario.label);
  }
});

test("shadow evidence rejects enumerable reason-count accessors before digest without running getters", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  let getterCalls = 0;
  Object.defineProperty(evidence.completeness.unresolvedReasonCounts, "close_time_not_proven_visible_at_decision", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls++;
      throw new Error("untrusted enumerable reason getter must not execute");
    },
  });

  const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  assert.equal(validation.valid, false);
  assert.equal(validation.evidence, null);
  assert.equal(getterCalls, 0);
  assert.ok(validation.errors.includes(
    "completeness.unresolvedReasonCounts.close_time_not_proven_visible_at_decision must be an own enumerable data field",
  ));
});

test("shadow evidence retains multi-reason row coverage without requiring one reason per row", () => {
  const original = input();
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input({
    reconciliation: {
      ...original.reconciliation,
      unresolved: [{
        sourceDecisionHistoryId: 99,
        reasons: ["close_time_not_proven_visible_at_decision", "identity_missing"],
      }],
    },
  }));
  assert.deepEqual(evidence.completeness.taxonomyCounts, {
    identity_completeness: 1,
    temporal_provenance: 1,
  });
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(evidence).valid, true);
});

test("shadow evidence preserves privacy and path denials under empty Object.entries", () => {
  const good = buildRuntimeDecisionLedgerShadowEvidence(input());
  const badPrivacy = buildRuntimeDecisionLedgerShadowEvidence(input());
  (badPrivacy.privacy as { rawRecordsIncluded: boolean }).rawRecordsIncluded = true;
  resign(badPrivacy);

  const badPath = buildRuntimeDecisionLedgerShadowEvidence(input());
  badPath.scope.modelVersion = "/synthetic/not-a-real-path";
  resign(badPath);

  const original = Object.getOwnPropertyDescriptor(Object, "entries");
  let observed: {
    good: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
    privacy: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
    path: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
  } | undefined;
  try {
    Object.defineProperty(Object, "entries", {
      configurable: true, writable: true, value() { return []; },
    });
    observed = {
      good: validateRuntimeDecisionLedgerShadowEvidence(good),
      privacy: validateRuntimeDecisionLedgerShadowEvidence(badPrivacy),
      path: validateRuntimeDecisionLedgerShadowEvidence(badPath),
    };
  } finally {
    if (original) Object.defineProperty(Object, "entries", original);
    else Reflect.deleteProperty(Object, "entries");
  }

  assert.equal(observed?.good.valid, true);
  assert.equal(observed?.privacy.valid, false);
  assert.ok(observed?.privacy.errors.includes("privacy.rawRecordsIncluded must be false"));
  assert.equal(observed?.path.valid, false);
  assert.ok(observed?.path.errors.includes("absolute path-like value at $.scope.modelVersion"));
});

test("shadow evidence cannot skip admission checks under an empty Array iterator", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const privacyDrift = buildRuntimeDecisionLedgerShadowEvidence(input());
  (privacyDrift.privacy as { rawRecordsIncluded: boolean }).rawRecordsIncluded = true;
  (privacyDrift.safety as { publicWrites: number }).publicWrites = 1;
  resign(privacyDrift);

  const sourceDrift = buildRuntimeDecisionLedgerShadowEvidence(input());
  sourceDrift.source.fileSizeBytes = -1;
  sourceDrift.sourceDescriptorDigest = sha256(sourceDrift.source);
  resign(sourceDrift);

  const extraField = buildRuntimeDecisionLedgerShadowEvidence(input()) as RuntimeDecisionLedgerShadowEvidence &
    { unapprovedMetadata?: string };
  extraField.unapprovedMetadata = "synthetic-only";

  const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  let observed: {
    good: RuntimeDecisionLedgerShadowEvidence;
    validGood: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
    privacy: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
    source: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
    extra: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence>;
  } | undefined;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true, writable: true,
      value: function* () { /* synthetic empty iterator */ },
    });
    const good = buildRuntimeDecisionLedgerShadowEvidence(input());
    observed = {
      good,
      validGood: validateRuntimeDecisionLedgerShadowEvidence(good),
      privacy: validateRuntimeDecisionLedgerShadowEvidence(privacyDrift),
      source: validateRuntimeDecisionLedgerShadowEvidence(sourceDrift),
      extra: validateRuntimeDecisionLedgerShadowEvidence(extraField),
    };
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, original);
  }

  assert.equal(observed?.good.contentDigest, baseline.contentDigest);
  assert.deepEqual(observed?.good.completeness.unresolvedReasonCounts, baseline.completeness.unresolvedReasonCounts);
  assert.deepEqual(observed?.good.completeness.taxonomyCounts, baseline.completeness.taxonomyCounts);
  assert.equal(observed?.validGood.valid, true, observed?.validGood.errors.join("; "));
  assert.equal(observed?.privacy.valid, false);
  assert.ok(observed?.privacy.errors.includes("privacy.rawRecordsIncluded must be false"));
  assert.ok(observed?.privacy.errors.includes("safety.publicWrites must be 0"));
  assert.equal(observed?.source.valid, false);
  assert.ok(observed?.source.errors.includes("source.fileSizeBytes must be a non-negative safe integer"));
  assert.equal(observed?.extra.valid, false);
  assert.ok(observed?.extra.errors.includes("unknown top-level field: unapprovedMetadata"));
});

test("shadow evidence validation verdict and errors cannot be rewritten after return", () => {
  const accepted = buildRuntimeDecisionLedgerShadowEvidence(input());
  const rejected = buildRuntimeDecisionLedgerShadowEvidence(input());
  (rejected.safety as { publicWrites: number }).publicWrites = 1;
  resign(rejected);

  const scenarios = [
    { label: "accepted", result: validateRuntimeDecisionLedgerShadowEvidence(accepted), valid: true },
    { label: "rejected", result: validateRuntimeDecisionLedgerShadowEvidence(rejected), valid: false },
    { label: "non-object", result: validateRuntimeDecisionLedgerShadowEvidence(null), valid: false },
  ];

  for (const { label, result, valid } of scenarios) {
    assert.equal(result.valid, valid, label);
    assert.equal(Object.isFrozen(result), true, label);
    assert.equal(Object.isFrozen(result.errors), true, label);
    const originalErrors = [...result.errors];
    assert.throws(() => { result.valid = !valid; }, TypeError, label);
    assert.throws(() => { result.errors.push("forged error"); }, TypeError, label);
    assert.throws(() => { result.errors[0] = "forged error"; }, TypeError, label);
    assert.equal(result.valid, valid, label);
    assert.deepEqual(result.errors, originalErrors, label);
  }

  assert.equal(scenarios[0]!.result.evidence, accepted);
  assert.equal(scenarios[1]!.result.evidence, null);
  assert.equal(scenarios[2]!.result.evidence, null);
  // Accepted evidence is still caller-owned; the validation result is not
  // an immutable evidence snapshot or an independent authority assertion.
  assert.equal(Object.isFrozen(accepted), false);
});


test("shadow evidence denies unknown top-level metadata under ambient Set.has allowlist forgery", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  (evidence as unknown as Record<string, unknown>).unapprovedMetadata = "synthetic";
  // Unknown top-level data is outside the canonical digestable field projection.
  // Before the guardrail, a selective Set.has hook admitted this unapproved field.
  const original = Object.getOwnPropertyDescriptor(Set.prototype, "has");
  assert.ok(original);
  let observed: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    const nativeHas = original.value as (this: Set<string>, key: string) => boolean;
    Object.defineProperty(Set.prototype, "has", {
      configurable: true,
      writable: true,
      value: function (this: Set<string>, key: string) {
        if (key === "unapprovedMetadata" && nativeHas.call(this, "schemaVersion")) return true;
        return nativeHas.call(this, key);
      },
    });
    observed = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  } finally {
    Object.defineProperty(Set.prototype, "has", original);
  }
  assert.equal(observed?.valid, false);
  assert.ok(observed?.errors.includes("unknown top-level field: unapprovedMetadata"));
});

test("shadow evidence denies missing privacy field under empty ambient Set iterator", () => {
  const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  delete (evidence.privacy as unknown as Record<string, unknown>).outcomeColumnsRead;
  resign(evidence);
  const original = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator);
  assert.ok(original);
  let observed: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(Set.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: function* () {},
    });
    observed = validateRuntimeDecisionLedgerShadowEvidence(evidence);
  } finally {
    Object.defineProperty(Set.prototype, Symbol.iterator, original);
  }
  assert.equal(observed?.valid, false);
  assert.ok(observed?.errors.includes("missing own enumerable data field: privacy.outcomeColumnsRead"));
});


test("shadow evidence denies rehashed taxonomy relabeling under ambient Map.has/get forgery", () => {
  const good = buildRuntimeDecisionLedgerShadowEvidence(input());
  const expectedDigest = good.contentDigest;
  const altered = buildRuntimeDecisionLedgerShadowEvidence(input());
  altered.completeness.taxonomyCounts = { schema_or_value: 1 };
  resign(altered);

  const originalHas = Object.getOwnPropertyDescriptor(Map.prototype, "has");
  const originalGet = Object.getOwnPropertyDescriptor(Map.prototype, "get");
  assert.ok(originalHas);
  assert.ok(originalGet);
  let observed: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(Map.prototype, "has", {
      configurable: true, writable: true, value() { return true; },
    });
    Object.defineProperty(Map.prototype, "get", {
      configurable: true, writable: true, value() { return 1; },
    });
    observed = validateRuntimeDecisionLedgerShadowEvidence(altered);
  } finally {
    Object.defineProperty(Map.prototype, "has", originalHas);
    Object.defineProperty(Map.prototype, "get", originalGet);
  }
  assert.equal(observed?.valid, false);
  assert.ok(observed?.errors.includes("completeness.taxonomyCounts mismatch"));
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(good).valid, true);
  assert.equal(good.contentDigest, expectedDigest);
});


test("shadow evidence denies root, nested and revoked Proxies without executing traps", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const expectedDigest = baseline.contentDigest;
  const trap = (): never => { throw new Error("untrusted Proxy trap must not execute"); };
  const hostile = <T extends object>(value: T): T => new Proxy(value, {
    get: trap,
    ownKeys: trap,
    getOwnPropertyDescriptor: trap,
  });
  const revoked = Proxy.revocable(baseline, {});
  revoked.revoke();

  for (const candidate of [hostile(baseline), revoked.proxy]) {
    const result = validateRuntimeDecisionLedgerShadowEvidence(candidate);
    assert.equal(result.valid, false);
    assert.equal(result.evidence, null);
    assert.ok(result.errors.includes("proxy value forbidden in evidence graph"));
  }

  for (const field of ["scope", "source", "reconciliation", "completeness", "privacy", "safety"] as const) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    (evidence as unknown as Record<string, unknown>)[field] = hostile(evidence[field]);
    const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(result.valid, false, field);
    assert.equal(result.evidence, null, field);
    assert.ok(result.errors.includes("proxy value forbidden in evidence graph"), field);
  }

  const countMap = buildRuntimeDecisionLedgerShadowEvidence(input());
  countMap.completeness.unresolvedReasonCounts = hostile(countMap.completeness.unresolvedReasonCounts);
  const countResult = validateRuntimeDecisionLedgerShadowEvidence(countMap);
  assert.equal(countResult.valid, false);
  assert.ok(countResult.errors.includes("proxy value forbidden in evidence graph"));

  const leaf = buildRuntimeDecisionLedgerShadowEvidence(input());
  (leaf.scope as unknown as Record<string, unknown>).runKind = hostile({});
  const leafResult = validateRuntimeDecisionLedgerShadowEvidence(leaf);
  assert.equal(leafResult.valid, false);
  assert.ok(leafResult.errors.includes("proxy value forbidden in evidence graph"));

  const revokedLeaf = Proxy.revocable({}, {});
  revokedLeaf.revoke();
  const nestedRevoked = buildRuntimeDecisionLedgerShadowEvidence(input());
  (nestedRevoked.source as unknown as Record<string, unknown>).journalMode = revokedLeaf.proxy;
  const revokedResult = validateRuntimeDecisionLedgerShadowEvidence(nestedRevoked);
  assert.equal(revokedResult.valid, false);
  assert.ok(revokedResult.errors.includes("proxy value forbidden in evidence graph"));

  const source = input().source;
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input({ source: hostile(source) })),
    /invalid canonical shadow evidence proxy/,
  );
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  assert.equal(baseline.contentDigest, expectedDigest);
});

test("shadow evidence builder preserves reason maps and digest under empty ambient Map keys iterator", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const original = Object.getOwnPropertyDescriptor(Map.prototype, "keys");
  assert.ok(original);
  let observed: RuntimeDecisionLedgerShadowEvidence | undefined;
  try {
    Object.defineProperty(Map.prototype, "keys", {
      configurable: true, writable: true,
      value: function* () { /* synthetic empty Map iterator */ },
    });
    observed = buildRuntimeDecisionLedgerShadowEvidence(input());
  } finally {
    Object.defineProperty(Map.prototype, "keys", original);
  }
  assert.deepEqual(observed?.completeness.unresolvedReasonCounts, baseline.completeness.unresolvedReasonCounts);
  assert.deepEqual(observed?.completeness.taxonomyCounts, baseline.completeness.taxonomyCounts);
  assert.equal(observed?.contentDigest, baseline.contentDigest);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(observed).valid, true);
});

test("shadow evidence builder preserves duplicate reason counts under ambient Map get forgery", () => {
  const scenario = input();
  scenario.reconciliation.mappedUnique = 0;
  scenario.reconciliation.unresolvedCount = 2;
  scenario.reconciliation.unresolved = [
    { sourceDecisionHistoryId: 98, reasons: ["close_time_not_proven_visible_at_decision"] },
    { sourceDecisionHistoryId: 99, reasons: ["close_time_not_proven_visible_at_decision"] },
  ];
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(scenario);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  const original = Object.getOwnPropertyDescriptor(Map.prototype, "get");
  assert.ok(original);
  let observed: RuntimeDecisionLedgerShadowEvidence | undefined;
  try {
    const nativeGet = original.value as (this: Map<string, number>, key: string) => number | undefined;
    Object.defineProperty(Map.prototype, "get", {
      configurable: true, writable: true,
      value: function (this: Map<string, number>, key: string) {
        if (key === "close_time_not_proven_visible_at_decision" || key === "temporal_provenance") return 0;
        return nativeGet.call(this, key);
      },
    });
    observed = buildRuntimeDecisionLedgerShadowEvidence(scenario);
  } finally {
    Object.defineProperty(Map.prototype, "get", original);
  }
  assert.deepEqual(observed?.completeness.unresolvedReasonCounts, { close_time_not_proven_visible_at_decision: 2 });
  assert.deepEqual(observed?.completeness.taxonomyCounts, { temporal_provenance: 2 });
  assert.equal(observed?.contentDigest, baseline.contentDigest);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(observed).valid, true);
});


test("shadow evidence preflight denies cyclic own-data before canonical digest, preserving shared acyclic references", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const baselineDigest = baseline.contentDigest;
  const selfCycle: Record<string, unknown> = {};
  selfCycle.self = selfCycle;

  const cyclicScope = buildRuntimeDecisionLedgerShadowEvidence(input());
  (cyclicScope.scope as unknown as Record<string, unknown>).runKind = selfCycle;
  const scopeResult = validateRuntimeDecisionLedgerShadowEvidence(cyclicScope);
  assert.equal(scopeResult.valid, false);
  assert.equal(scopeResult.evidence, null);
  assert.ok(scopeResult.errors.includes("cyclic reference forbidden in evidence graph"));

  const cyclicCountMap = buildRuntimeDecisionLedgerShadowEvidence(input());
  (cyclicCountMap.completeness.unresolvedReasonCounts as Record<string, unknown>).loop = selfCycle;
  const countResult = validateRuntimeDecisionLedgerShadowEvidence(cyclicCountMap);
  assert.equal(countResult.valid, false);
  assert.ok(countResult.errors.includes("cyclic reference forbidden in evidence graph"));

  const clean = input();
  const shared = buildRuntimeDecisionLedgerShadowEvidence({
    ...clean,
    scope: { ...clean.scope, returnedRows: 1 },
    reconciliation: {
      ...clean.reconciliation,
      status: "PASS",
      sourceRows: 1,
      mappedUnique: 1,
      unresolvedCount: 0,
      unresolved: [],
    },
  });
  shared.completeness.rejectedReasonCounts = shared.completeness.unresolvedReasonCounts;
  const sharedResult = validateRuntimeDecisionLedgerShadowEvidence(shared);
  assert.equal(sharedResult.valid, true, sharedResult.errors.join("; "));
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  assert.equal(baseline.contentDigest, baselineDigest);
});

test("shadow evidence rejects rehashed positive reason counts for zero-row categories", () => {
  const baseline = input();
  const cleanInput = input({
    scope: { ...baseline.scope, returnedRows: 1 },
    reconciliation: {
      ...baseline.reconciliation,
      status: "PASS",
      sourceRows: 1,
      mappedUnique: 1,
      unresolvedCount: 0,
      rejectedCount: 0,
      unresolved: [],
      rejected: [],
    },
  });
  const clean = buildRuntimeDecisionLedgerShadowEvidence(cleanInput);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(clean).valid, true);
  assert.equal(clean.verdict, "PASS");

  for (const category of ["unresolved", "rejected"] as const) {
    const forged = buildRuntimeDecisionLedgerShadowEvidence(cleanInput);
    if (category === "unresolved") {
      forged.completeness.unresolvedReasonCounts = { synthetic_reason: 1 };
    } else {
      forged.completeness.rejectedReasonCounts = { synthetic_reason: 1 };
    }
    forged.completeness.taxonomyCounts = { schema_or_value: 1 };
    resign(forged);
    const result = validateRuntimeDecisionLedgerShadowEvidence(forged);
    assert.equal(result.valid, false, category);
    assert.equal(result.evidence, null);
    assert.ok(result.errors.includes(
      `completeness.${category}ReasonCounts must be empty when ${category}Count is zero`,
    ));
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(clean).valid, true);
});

test("shadow evidence rejects re-digested zero-valued phantom reason and taxonomy keys", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const forgedUnresolved = structuredClone(baseline);
  forgedUnresolved.completeness.unresolvedReasonCounts = {
    ...forgedUnresolved.completeness.unresolvedReasonCounts,
    synthetic_phantom: 0,
  };
  forgedUnresolved.completeness.taxonomyCounts = {
    ...forgedUnresolved.completeness.taxonomyCounts,
    schema_or_value: 0,
  };
  resign(forgedUnresolved);
  const unresolvedResult = validateRuntimeDecisionLedgerShadowEvidence(forgedUnresolved);
  assert.equal(unresolvedResult.valid, false);
  assert.equal(unresolvedResult.evidence, null);
  assert.ok(unresolvedResult.errors.includes(
    "completeness.unresolvedReasonCounts.synthetic_phantom must be positive",
  ));
  assert.ok(unresolvedResult.errors.includes(
    "completeness.taxonomyCounts.schema_or_value must be positive",
  ));

  const forgedRejected = structuredClone(baseline);
  forgedRejected.completeness.rejectedReasonCounts = { synthetic_phantom: 0 };
  forgedRejected.completeness.taxonomyCounts = {
    ...forgedRejected.completeness.taxonomyCounts,
    schema_or_value: 0,
  };
  resign(forgedRejected);
  const rejectedResult = validateRuntimeDecisionLedgerShadowEvidence(forgedRejected);
  assert.equal(rejectedResult.valid, false);
  assert.ok(rejectedResult.errors.includes(
    "completeness.rejectedReasonCounts.synthetic_phantom must be positive",
  ));

  const forgedTaxonomy = structuredClone(baseline);
  forgedTaxonomy.completeness.taxonomyCounts = {
    ...forgedTaxonomy.completeness.taxonomyCounts,
    identity_conflict: 0,
  };
  resign(forgedTaxonomy);
  const taxonomyResult = validateRuntimeDecisionLedgerShadowEvidence(forgedTaxonomy);
  assert.equal(taxonomyResult.valid, false);
  assert.ok(taxonomyResult.errors.includes(
    "completeness.taxonomyCounts.identity_conflict must be positive",
  ));

  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});

test("shadow evidence taxonomy is stable under ambient String.includes forgery", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.deepEqual(baseline.completeness.taxonomyCounts, { temporal_provenance: 1 });
  const original = Object.getOwnPropertyDescriptor(String.prototype, "includes");
  assert.ok(original);
  let observed: RuntimeDecisionLedgerShadowEvidence | undefined;
  let validation: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(String.prototype, "includes", {
      configurable: true, writable: true, value() { return false; },
    });
    observed = buildRuntimeDecisionLedgerShadowEvidence(input());
    validation = validateRuntimeDecisionLedgerShadowEvidence(observed);
  } finally {
    Object.defineProperty(String.prototype, "includes", original);
  }
  assert.deepEqual(observed?.completeness.taxonomyCounts, baseline.completeness.taxonomyCounts);
  assert.equal(observed?.contentDigest, baseline.contentDigest);
  assert.equal(validation?.valid, true, validation?.errors.join("; "));
});

test("shadow evidence denies embedded synthetic path markers despite String.includes forgery", () => {
  const scopePath = buildRuntimeDecisionLedgerShadowEvidence(input());
  scopePath.scope.modelVersion = "synthetic/Users/placeholder";
  resign(scopePath);
  const reasonPath = buildRuntimeDecisionLedgerShadowEvidence(input());
  reasonPath.completeness.unresolvedReasonCounts = { "synthetic/Users/placeholder": 1 };
  reasonPath.completeness.taxonomyCounts = { schema_or_value: 1 };
  resign(reasonPath);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(scopePath).valid, false);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(reasonPath).valid, false);

  const original = Object.getOwnPropertyDescriptor(String.prototype, "includes");
  assert.ok(original);
  let scopeResult: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  let reasonResult: ReturnType<typeof validateRuntimeDecisionLedgerShadowEvidence> | undefined;
  try {
    Object.defineProperty(String.prototype, "includes", {
      configurable: true, writable: true, value() { return false; },
    });
    scopeResult = validateRuntimeDecisionLedgerShadowEvidence(scopePath);
    reasonResult = validateRuntimeDecisionLedgerShadowEvidence(reasonPath);
  } finally {
    Object.defineProperty(String.prototype, "includes", original);
  }
  assert.equal(scopeResult?.valid, false);
  assert.ok(scopeResult?.errors.some((message) => message.includes("absolute path-like value")));
  assert.equal(reasonResult?.valid, false);
  assert.ok(reasonResult?.errors.includes("completeness.unresolvedReasonCounts contains forbidden reason key"));
});

test("shadow evidence rejects bigint fields before JSON digest without throwing", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const cases: Array<{
    label: string;
    mutate: (evidence: RuntimeDecisionLedgerShadowEvidence) => void;
  }> = [
    {
      label: "source descriptor bigint",
      mutate: (evidence) => {
        (evidence.source as unknown as Record<string, unknown>).fileSizeBytes = 1n;
      },
    },
    {
      label: "scope limit bigint",
      mutate: (evidence) => {
        (evidence.scope as unknown as Record<string, unknown>).limit = 1n;
      },
    },
    {
      label: "privacy flag bigint",
      mutate: (evidence) => {
        (evidence.privacy as unknown as Record<string, unknown>).rawRecordsIncluded = 1n;
      },
    },
  ];
  for (const scenario of cases) {
    const evidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    scenario.mutate(evidence);
    const observed = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(observed.valid, false, scenario.label);
    assert.equal(observed.evidence, null, scenario.label);
    assert.ok(observed.errors.includes("non-JSON bigint forbidden in evidence graph"), scenario.label);
  }
  const ordinary = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(ordinary).valid, true);
  assert.equal(ordinary.contentDigest, baseline.contentDigest);
  assert.equal(ordinary.sourceDescriptorDigest, baseline.sourceDescriptorDigest);
});

test("shadow evidence denies embedded absolute path tokens without rejecting ordinary HTTPS metadata", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  const pathMarkers = [
    "diagnostic /home/synthetic-fixture/trace.log",
    "diagnostic C:\\synthetic-fixture\\trace.log",
    "diagnostic \\\\synthetic-fixture\\share\\trace.log",
    "diagnostic file:///synthetic-fixture/trace.log",
  ];
  for (const marker of pathMarkers) {
    const scopeEvidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    scopeEvidence.scope.modelVersion = marker;
    resign(scopeEvidence);
    const scopeResult = validateRuntimeDecisionLedgerShadowEvidence(scopeEvidence);
    assert.equal(scopeResult.valid, false, marker);
    assert.ok(scopeResult.errors.includes("absolute path-like value at $.scope.modelVersion"), marker);

    const reasonEvidence = buildRuntimeDecisionLedgerShadowEvidence(input());
    reasonEvidence.completeness.unresolvedReasonCounts = { [marker]: 1 };
    reasonEvidence.completeness.taxonomyCounts = { schema_or_value: 1 };
    resign(reasonEvidence);
    const reasonResult = validateRuntimeDecisionLedgerShadowEvidence(reasonEvidence);
    assert.equal(reasonResult.valid, false, marker);
    assert.ok(reasonResult.errors.includes("completeness.unresolvedReasonCounts contains forbidden reason key"), marker);
  }

  const ordinary = buildRuntimeDecisionLedgerShadowEvidence(input());
  ordinary.scope.modelVersion = "https://example.test/research";
  resign(ordinary);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(ordinary).valid, true);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});


test("shadow canonical digest rejects own callable toJSON and isolates arrays from ambient toJSON", () => {
  const baselineInput = input();
  let hooksCalled = 0;
  const forgedContext = { ...baselineInput.context };
  Object.defineProperty(forgedContext, "toJSON", {
    enumerable: true, configurable: true,
    value() { hooksCalled++; return { decisionSystem: "synthetic-forgery" }; },
  });
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input({ context: forgedContext })),
    /invalid canonical shadow evidence function/,
  );
  assert.equal(hooksCalled, 0, "caller-owned toJSON must not execute");

  const invalidEvidence = buildRuntimeDecisionLedgerShadowEvidence(input());
  (invalidEvidence.scope as unknown as Record<string, unknown>).runKind = () => "synthetic";
  const denial = validateRuntimeDecisionLedgerShadowEvidence(invalidEvidence);
  assert.equal(denial.valid, false);
  assert.equal(denial.evidence, null);
  assert.ok(denial.errors.includes("non-JSON function forbidden in evidence graph"));

  // A deliberately extra synthetic array probes the digest boundary, not a
  // claim that an array is a valid mapping-context field.
  const contextWithArray = {
    ...baselineInput.context,
    syntheticDigestProbe: ["synthetic-marker"],
  } as typeof baselineInput.context;
  const stable = buildRuntimeDecisionLedgerShadowEvidence(input({ context: contextWithArray }));
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  try {
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true, writable: true,
      value() { hooksCalled++; return ["synthetic-forgery"]; },
    });
    const observed = buildRuntimeDecisionLedgerShadowEvidence(input({ context: contextWithArray }));
    assert.equal(observed.contextDigest, stable.contextDigest);
    assert.equal(observed.contentDigest, stable.contentDigest);
    assert.equal(hooksCalled, 0, "ambient array toJSON must not execute");
  } finally {
    if (original) Object.defineProperty(Array.prototype, "toJSON", original);
    else delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(buildRuntimeDecisionLedgerShadowEvidence(input())).valid, true);
});

test("shadow canonical builder denies silent non-JSON scalar digest aliases", () => {
  // The old JSON projection dropped undefined/symbol and coerced non-finite numbers to null.
  assert.equal(sha256({ manifestId: undefined }), sha256({}));
  assert.equal(sha256({ manifestId: Symbol("synthetic") }), sha256({}));
  assert.equal(sha256({ manifestId: Number.NaN }), sha256({ manifestId: null }));
  assert.equal(sha256({ manifestId: Number.POSITIVE_INFINITY }), sha256({ manifestId: null }));

  const baselineInput = input();
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(baselineInput);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  for (const malformed of [undefined, Symbol("synthetic"), Number.NaN, Number.POSITIVE_INFINITY]) {
    const context = { ...baselineInput.context, manifestId: malformed as unknown as string };
    assert.throws(
      () => buildRuntimeDecisionLedgerShadowEvidence(input({ context })),
      /invalid canonical shadow evidence non-JSON primitive/,
    );
  }
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input({
      source: { ...baselineInput.source, modifiedTimeMs: Number.NaN },
    })),
    /invalid canonical shadow evidence non-JSON primitive/,
  );
  assert.equal(buildRuntimeDecisionLedgerShadowEvidence(input()).contentDigest, baseline.contentDigest);
});

test("shadow validator denies non-JSON scalar evidence before digest evaluation", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input());
  for (const [malformed, expected] of [
    [undefined, "non-JSON undefined forbidden in evidence graph"],
    [Symbol("synthetic"), "non-JSON symbol forbidden in evidence graph"],
    [Number.NaN, "non-finite number forbidden in evidence graph"],
    [Number.POSITIVE_INFINITY, "non-finite number forbidden in evidence graph"],
  ] as const) {
    const evidence = structuredClone(baseline);
    (evidence.scope as unknown as Record<string, unknown>).modelVersion = malformed;
    const result = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(result.valid, false);
    assert.equal(result.evidence, null);
    assert.ok(result.errors.includes(expected));
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
});

test("shadow canonical digest denies omitted own property keys and exotic prototypes", () => {
  const baselineInput = input();
  const baseContext = { ...baselineInput.context };
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(baselineInput);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const hiddenContext = { ...baseContext };
  Object.defineProperty(hiddenContext, "syntheticHidden", {
    value: "synthetic-different", enumerable: false, configurable: true,
  });
  const symbolContext = { ...baseContext };
  Object.defineProperty(symbolContext, Symbol("syntheticHidden"), {
    value: "synthetic-different", enumerable: true, configurable: true,
  });
  const inheritedContext = Object.create({ syntheticInherited: "synthetic-different" }) as typeof baseContext;
  Object.assign(inheritedContext, baseContext);

  for (const [context, denial] of [
    [hiddenContext, /invalid canonical shadow evidence non-data property/],
    [symbolContext, /invalid canonical shadow evidence symbol key/],
    [inheritedContext, /invalid canonical shadow evidence object prototype/],
  ] as const) {
    // This reproduces the old JSON projection alias with synthetic metadata.
    assert.equal(sha256(context), sha256(baseContext));
    assert.throws(
      () => buildRuntimeDecisionLedgerShadowEvidence(input({ context })),
      denial,
    );
  }

  const exoticContext = new Date("2026-08-05T00:00:00.000Z") as unknown as typeof baseContext;
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input({ context: exoticContext })),
    /invalid canonical shadow evidence object prototype/,
  );

  const hiddenSource = { ...baselineInput.source };
  Object.defineProperty(hiddenSource, "syntheticHidden", {
    value: "synthetic-different", enumerable: false, configurable: true,
  });
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input({ source: hiddenSource })),
    /invalid canonical shadow evidence non-data property/,
  );

  const unchanged = buildRuntimeDecisionLedgerShadowEvidence(input());
  assert.equal(unchanged.contextDigest, baseline.contextDigest);
  assert.equal(unchanged.contentDigest, baseline.contentDigest);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(unchanged).valid, true);
});
