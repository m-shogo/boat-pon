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
    assert.ok(result.errors.includes("source.walPresent must be false"));
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
      expected: /unresolvedReasonCounts must have a plain object prototype/,
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
