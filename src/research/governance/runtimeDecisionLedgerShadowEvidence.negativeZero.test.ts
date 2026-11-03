import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// Synthetic metadata only. No private DB, odds, source records or production inputs.
function input(fileSizeBytes: number): RuntimeDecisionLedgerShadowEvidenceInput {
  return {
    generatedAt: "2026-08-05T08:10:00.000Z",
    source: {
      fileSizeBytes,
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
    context: {
      decisionSystem: "synthetic-shadow",
      strategyVersion: "synthetic-v1",
      featureVersion: "synthetic-features",
      manifestId: "synthetic-manifest",
      cohortId: "synthetic-cohort",
      evaluationMode: "formal_forward",
    },
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

test("shadow source digest rejects negative-zero JSON alias and preserves ordinary zero", () => {
  assert.equal(Object.is(-0, 0), false);
  assert.equal(Number.isSafeInteger(-0) && -0 >= 0, true);
  assert.equal(JSON.stringify(input(-0).source), JSON.stringify(input(0).source));

  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input(0));
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(input(-0)),
    /invalid canonical shadow evidence negative zero/,
  );
  assert.equal(buildRuntimeDecisionLedgerShadowEvidence(input(0)).sourceDescriptorDigest,
    baseline.sourceDescriptorDigest);
});

test("shadow validator fails closed on re-digested negative-zero fields", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(input(0));
  const mutated = structuredClone(baseline);
  mutated.source.fileSizeBytes = -0;
  // The existing SHA-256 claims still match the JSON projection: -0 becomes 0.
  assert.equal(JSON.stringify(mutated.source), JSON.stringify(baseline.source));
  const result = validateRuntimeDecisionLedgerShadowEvidence(mutated);
  assert.equal(result.valid, false);
  assert.equal(result.evidence, null);
  assert.deepEqual(result.errors, ["negative zero forbidden in evidence graph"]);
});

test("shadow context digest rejects negative-zero probe without changing normal digests", () => {
  const withProbe = (probe: number) => {
    const value = input(0);
    const contextWithProbe = { ...value.context, syntheticDigestProbe: probe };
    value.context = contextWithProbe;
    return value;
  };
  assert.equal(JSON.stringify(withProbe(-0).context), JSON.stringify(withProbe(0).context));
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(withProbe(0));
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  assert.throws(
    () => buildRuntimeDecisionLedgerShadowEvidence(withProbe(-0)),
    /invalid canonical shadow evidence negative zero/,
  );
  assert.equal(buildRuntimeDecisionLedgerShadowEvidence(withProbe(0)).contextDigest,
    baseline.contextDigest);
});
