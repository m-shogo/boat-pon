import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeDecisionLedgerShadowEvidence,
  validateRuntimeDecisionLedgerShadowEvidence,
  type RuntimeDecisionLedgerShadowEvidenceInput,
} from "./runtimeDecisionLedgerShadowEvidence";

// Synthetic evidence only: no operational database, odds or private paths.
function fixture(): RuntimeDecisionLedgerShadowEvidenceInput {
  return {
    generatedAt: "2026-08-05T08:10:00.000Z",
    source: {
      fileSizeBytes: 0, modifiedTimeMs: 1_786_000_000_000,
      sqliteSchemaVersion: 42, sqliteUserVersion: 0, pageCount: 1,
      pageSizeBytes: 4096, freelistCount: 0, journalMode: "wal",
      walPresent: false, readOnly: true, queryOnly: true,
    },
    scope: {
      runKind: "synthetic", modelVersion: "synthetic-v1",
      from: "2026-01-01", to: "2026-08-05", limit: 500,
      returnedRows: 1, limitReached: false, bounded: true,
    },
    context: {
      decisionSystem: "synthetic-shadow", strategyVersion: "synthetic-v1",
      featureVersion: "synthetic-features", manifestId: "synthetic-manifest",
      cohortId: "synthetic-cohort", evaluationMode: "formal_forward",
    },
    reconciliation: {
      status: "PASS", sourceRows: 1, mappedUnique: 1,
      exactDuplicates: 0, unresolvedCount: 0, rejectedCount: 0,
      conflictCount: 0, recordsDigest: "a".repeat(64),
      records: [], unresolved: [], rejected: [], conflicts: [],
    },
  };
}

test("shadow evidence rejects inherited root metadata despite identical JSON", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(fixture());
  assert.equal(validateRuntimeDecisionLedgerShadowEvidence(baseline).valid, true);
  const altered = structuredClone(baseline);
  Object.setPrototypeOf(altered, { syntheticInheritedMarker: "untrusted" });
  assert.equal(JSON.stringify(altered), JSON.stringify(baseline));
  const result = validateRuntimeDecisionLedgerShadowEvidence(altered);
  assert.equal(result.valid, false);
  assert.equal(result.evidence, null);
  assert.deepEqual(result.errors, ["non-plain prototype forbidden in evidence graph"]);
});

test("shadow evidence fails closed before source digest on exotic prototype", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(fixture());
  const altered = structuredClone(baseline);
  Object.setPrototypeOf(altered.source, { syntheticInheritedMarker: "untrusted" });
  assert.equal(JSON.stringify(altered), JSON.stringify(baseline));
  const result = validateRuntimeDecisionLedgerShadowEvidence(altered);
  assert.equal(result.valid, false);
  assert.equal(result.evidence, null);
  assert.deepEqual(result.errors, ["non-plain prototype forbidden in evidence graph"]);
});

test("shadow evidence permits explicit null prototypes with unchanged digest", () => {
  const baseline = buildRuntimeDecisionLedgerShadowEvidence(fixture());
  const altered = structuredClone(baseline);
  Object.setPrototypeOf(altered, null);
  Object.setPrototypeOf(altered.source, null);
  assert.equal(JSON.stringify(altered), JSON.stringify(baseline));
  const result = validateRuntimeDecisionLedgerShadowEvidence(altered);
  assert.equal(result.valid, true);
  assert.equal(result.evidence?.contentDigest, baseline.contentDigest);
});
