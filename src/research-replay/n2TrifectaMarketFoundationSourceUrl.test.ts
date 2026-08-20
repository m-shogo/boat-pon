import assert from "node:assert/strict";
import test from "node:test";

import {
  auditN2TrifectaMarketSnapshot,
  buildCanonicalTrifectaSelectionSpace,
  type N2TrifectaMarketSnapshotCandidate,
} from "./n2TrifectaMarketFoundation";

function candidate(sourceUrl: string | null): N2TrifectaMarketSnapshotCandidate {
  return {
    raceId: "20260806-05-01",
    checkpointLabel: "T-10",
    availableAt: "2026-08-06T03:49:00.000Z",
    capturedAt: "2026-08-06T03:50:00.000Z",
    decisionCutoff: "2026-08-06T04:00:00.000Z",
    rawDocumentId: "raw-doc-01",
    rawPayloadDigest: "a".repeat(64),
    parseRunId: "parse-01",
    sourceUrl,
    proposedObservationId: "obs-01",
    odds: buildCanonicalTrifectaSelectionSpace().map((selection, index) => ({
      selection,
      odds: index + 1.5,
    })),
  };
}

test("foundation rejects malformed HTTP(S) source URLs", () => {
  for (const sourceUrl of [
    "https://",
    "http://",
    " https://example.invalid/official-market",
    "https://example.invalid/official-market ",
    "ftp://example.invalid/official-market",
  ]) {
    const audit = auditN2TrifectaMarketSnapshot(candidate(sourceUrl));
    assert.equal(audit.status, "BLOCKED");
    assert.equal(audit.lineage.status, "BLOCKED");
    assert.ok(audit.blockers.includes("SOURCE_URL_INVALID"));
  }
});

test("foundation keeps optional null and valid HTTP(S) source URLs accepted", () => {
  for (const sourceUrl of [
    null,
    "https://example.invalid/official-market",
    "http://example.invalid/official-market?race=1",
  ]) {
    const audit = auditN2TrifectaMarketSnapshot(candidate(sourceUrl));
    assert.equal(audit.status, "PASS");
    assert.equal(audit.lineage.status, "PASS");
  }
});
