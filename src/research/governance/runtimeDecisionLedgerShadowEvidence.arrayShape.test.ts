import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// Synthetic metadata only: no DB, private source row, odds or production input.
function inputWithArray(array: unknown[]): RuntimeDecisionLedgerShadowEvidenceInput {
  const context: RuntimeDecisionLedgerShadowEvidenceInput["context"] = {
    decisionSystem: "synthetic-shadow",
    strategyVersion: "synthetic-v1",
    featureVersion: "synthetic-features",
    manifestId: "synthetic-manifest",
    cohortId: "synthetic-cohort",
    evaluationMode: "formal_forward",
  };
  const contextWithProbe = { ...context, syntheticDigestProbe: array } as typeof context;
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
      runKind: "synthetic",
      modelVersion: "synthetic-v1",
      from: "2026-01-01",
      to: "2026-08-05",
      limit: 500,
      returnedRows: 1,
      limitReached: false,
      bounded: true,
    },
    context: contextWithProbe,
    reconciliation: {
      status: "PASS",
      sourceRows: 1,
      mappedUnique: 1,
      exactDuplicates: 0,
      unresolvedCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      recordsDigest: "a".repeat(64),
      records: [],
      unresolved: [],
      rejected: [],
      conflicts: [],
    },
  };
}

test("shadow canonical arrays bind extra, hidden and symbol own metadata", () => {
  const baselineArray = ["synthetic-marker"];
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(baselineArray));
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);

  const hidden = ["synthetic-marker"];
  Object.defineProperty(hidden, "syntheticHidden", {
    value: "different", enumerable: false, configurable: true,
  });
  const extra = ["synthetic-marker"] as string[] & { extra?: string };
  extra.extra = "different";
  const symbolKeyed = ["synthetic-marker"];
  Object.defineProperty(symbolKeyed, Symbol("synthetic"), {
    value: "different", enumerable: true, configurable: true,
  });

  for (const [label, array] of [
    ["hidden", hidden], ["extra", extra], ["symbol", symbolKeyed],
  ] as const) {
    assert.equal(JSON.stringify(array), JSON.stringify(baselineArray), label);
    assert.throws(
      () => buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(array)),
      /invalid canonical shadow evidence array own shape/,
      label,
    );
  }
  const unchanged = buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(["synthetic-marker"]));
  assert.equal(unchanged.contextDigest, baseline.contextDigest);
  assert.equal(unchanged.contentDigest, baseline.contentDigest);
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(unchanged).valid, true);
});

test("shadow canonical arrays deny sparse, accessor and exotic prototype shapes", () => {
  const sparse = Array<null>(1);
  assert.equal(JSON.stringify(sparse), JSON.stringify([null]));
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(sparse)),
    /invalid canonical shadow evidence array own shape/,
  );

  let getterCalls = 0;
  const accessor = ["synthetic-marker"];
  Object.defineProperty(accessor, "0", {
    get() { getterCalls++; return "forged"; },
    enumerable: true, configurable: true,
  });
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(accessor)),
    /invalid canonical shadow evidence array/,
  );
  assert.equal(getterCalls, 0, "caller-owned index getter must not execute");

  const exotic = ["synthetic-marker"];
  Object.setPrototypeOf(exotic, { syntheticInherited: "different" });
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(inputWithArray(exotic)),
    /invalid canonical shadow evidence array prototype/,
  );
});
