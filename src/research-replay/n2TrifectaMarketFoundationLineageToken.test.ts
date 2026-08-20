import assert from "node:assert/strict";
import test from "node:test";

import {
  auditN2TrifectaMarketSnapshot,
  buildCanonicalTrifectaSelectionSpace,
  type N2TrifectaMarketSnapshotCandidate,
} from "./n2TrifectaMarketFoundation";

function candidate(overrides: Partial<N2TrifectaMarketSnapshotCandidate> = {}): N2TrifectaMarketSnapshotCandidate {
  return {
    raceId: "20260806-05-01",
    checkpointLabel: "T-10",
    availableAt: "2026-08-06T03:49:00.000Z",
    capturedAt: "2026-08-06T03:50:00.000Z",
    decisionCutoff: "2026-08-06T04:00:00.000Z",
    rawDocumentId: "raw-doc-01",
    rawPayloadDigest: "a".repeat(64),
    parseRunId: "parse-01",
    sourceUrl: "https://example.invalid/official-market",
    proposedObservationId: "obs-01",
    odds: buildCanonicalTrifectaSelectionSpace().map((selection, index) => ({ selection, odds: index + 1.5 })),
    ...overrides,
  };
}

test("foundation rejects whitespace-padded checkpoint identity tokens", () => {
  for (const overrides of [
    { checkpointLabel: " T-10" },
    { checkpointLabel: "T-10 " },
    { rawDocumentId: " raw-doc-01" },
    { rawDocumentId: "raw-doc-01 " },
  ]) {
    const audit = auditN2TrifectaMarketSnapshot(candidate(overrides));
    assert.equal(audit.status, "BLOCKED");
    assert.equal(audit.checkpointIdentity, null);
    assert.ok(audit.blockers.includes("CHECKPOINT_IDENTITY_UNRESOLVED"));
  }
});

test("foundation rejects whitespace-padded idempotency lineage tokens", () => {
  for (const overrides of [
    { parseRunId: " parse-01" },
    { parseRunId: "parse-01 " },
    { proposedObservationId: " obs-01" },
    { proposedObservationId: "obs-01 " },
  ]) {
    const audit = auditN2TrifectaMarketSnapshot(candidate(overrides));
    assert.equal(audit.status, "BLOCKED");
    assert.equal(audit.idempotencyKey, null);
    assert.ok(audit.blockers.includes("IDEMPOTENCY_KEY_UNRESOLVED"));
  }
});

test("foundation keeps canonical lineage tokens accepted", () => {
  const audit = auditN2TrifectaMarketSnapshot(candidate());
  assert.equal(audit.status, "PASS");
  assert.match(audit.checkpointIdentity ?? "", /^[0-9a-f]{64}$/);
  assert.match(audit.idempotencyKey ?? "", /^[0-9a-f]{64}$/);
});
