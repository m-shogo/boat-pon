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

test("selected feature reader rejects candidate identity mismatches before private database read", () => {
  const wrongVenue = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{ ...BASE, primaryRaceId: "20040101-戸田-01" }],
  });
  assert.equal(wrongVenue.status, "BLOCKED");
  assert.ok(wrongVenue.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`));
  assert.equal(wrongVenue.primaryDatabaseReadCount, 0);
  assert.equal(wrongVenue.rawJsonReadCount, 0);

  const wrongRaceNo = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{ ...BASE, primaryRaceId: "20040101-びわこ-02" }],
  });
  assert.equal(wrongRaceNo.status, "BLOCKED");
  assert.ok(wrongRaceNo.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`));
  assert.equal(wrongRaceNo.primaryDatabaseReadCount, 0);
  assert.equal(wrongRaceNo.rawJsonReadCount, 0);

  const wrongEncoding = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{ ...BASE, primaryRaceId: "20040101-11-01" }],
  });
  assert.equal(wrongEncoding.status, "BLOCKED");
  assert.ok(wrongEncoding.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`));
  assert.equal(wrongEncoding.primaryDatabaseReadCount, 0);
  assert.equal(wrongEncoding.rawJsonReadCount, 0);
});

test("selected feature reader rejects impossible race dates before private database read", () => {
  const canonicalRaceKey = "2004-02-30:11:R1";
  const impossibleDate = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/private/should-not-be-opened.sqlite",
    selectedCandidates: [{
      ...BASE,
      canonicalRaceKey,
      primaryRaceId: "20040230-びわこ-01",
    }],
  });
  assert.equal(impossibleDate.status, "BLOCKED");
  assert.ok(impossibleDate.blockers.includes(`${canonicalRaceKey}:INVALID_SELECTED_IDENTITY`));
  assert.equal(impossibleDate.primaryDatabaseReadCount, 0);
  assert.equal(impossibleDate.rawJsonReadCount, 0);
});

test("selected feature reader keeps producer-canonical identity and timestamps eligible for database access", () => {
  const labelIdentity = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/does/not/exist.sqlite",
    selectedCandidates: [BASE],
  });
  assert.equal(labelIdentity.status, "BLOCKED");
  assert.equal(labelIdentity.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`), false);
  assert.equal(labelIdentity.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_DECISION_CUTOFF`), false);
  assert.equal(labelIdentity.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SOURCE_OBSERVED_AT`), false);

  const codeIdentity = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/does/not/exist.sqlite",
    selectedCandidates: [{ ...BASE, primaryRaceId: "20040101-11-01", primaryIdentityEncoding: "venue_code" }],
  });
  assert.equal(codeIdentity.status, "BLOCKED");
  assert.equal(codeIdentity.blockers.includes(`${BASE.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`), false);
});