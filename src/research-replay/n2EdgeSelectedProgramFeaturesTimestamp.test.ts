import assert from "node:assert/strict";
import test from "node:test";

import type { N2EdgeDiscoveryCandidate } from "./n2EdgeDiscoverySource";
import { readN2EdgeSelectedProgramFeatures } from "./n2EdgeSelectedProgramFeatures";

const BASE: N2EdgeDiscoveryCandidate = {
  canonicalRaceKey: "2004-01-01:11:R1",
  primaryRaceId: "20040101-びわこ-01",
  primaryIdentityEncoding: "venue_label",
  decisionCutoff: "2004-01-01T14:00:00.000Z",
  sourceObservedAt: "2004-01-01T01:00:00.000Z",
};

test("selected feature reader rejects normalized timestamps before private database read", () => {
  const invalidCutoff = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{ ...BASE, decisionCutoff: "2004-01-01T24:00:00.000Z" }],
  });
  assert.equal(invalidCutoff.status, "BLOCKED");
  assert.ok(invalidCutoff.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_DECISION_CUTOFF`));
  assert.equal(invalidCutoff.primaryDatabaseReadCount, 0);
  assert.equal(invalidCutoff.rawJsonReadCount, 0);

  const nonCanonicalObservedAt = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{ ...BASE, sourceObservedAt: "2004-01-01T10:00:00+09:00" }],
  });
  assert.equal(nonCanonicalObservedAt.status, "BLOCKED");
  assert.ok(nonCanonicalObservedAt.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SOURCE_OBSERVED_AT`));
  assert.equal(nonCanonicalObservedAt.primaryDatabaseReadCount, 0);
  assert.equal(nonCanonicalObservedAt.rawJsonReadCount, 0);
});

test("selected feature reader keeps producer-canonical timestamps eligible for database access", () => {
  const result = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/does/not/exist.sqlite",
    selectedCandidates: [BASE],
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_DECISION_CUTOFF`), false);
  assert.equal(result.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SOURCE_OBSERVED_AT`), false);
});
