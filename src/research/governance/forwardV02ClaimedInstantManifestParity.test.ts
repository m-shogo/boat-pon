import assert from "node:assert/strict";
import test from "node:test";
import {
  compareForwardV02ClaimedInstants,
  validForwardV02ClaimedInstant,
} from "./forwardV02ClaimedInstant";
import { forwardV02SourceManifestReferenceDigest } from "./forwardV02ReferenceReconciliation";

/**
 * Synthetic cross-boundary contract: a standalone source-manifest reference
 * must not assign a digest to a timestamp rejected by the shared claimed-clock
 * preflight. Neither accepted shape nor matching content authenticates time,
 * source authority, settlement finality, or scoring permission.
 */
const manifest = (createdAt: string) => ({
  schemaVersion: "forward-source-manifest.0.2-candidate",
  manifestId: "synthetic-claimed-clock-parity",
  evidenceStage: "SHADOW_FORWARD",
  analysisSnapshotDigest: "a".repeat(64),
  decisionDigests: ["b".repeat(64)],
  outcomeDigests: ["c".repeat(64)],
  createdAt,
  productionConnection: false,
});

test("source-manifest digest and shared claimed-clock guard agree on synthetic calendar and offset boundaries", () => {
  const cases = [
    ["0001-01-01T00:00:00Z", true],
    ["2000-02-29T00:00:00.000000001+00:00", true],
    ["2024-02-29T23:59:59.999999999-23:59", true],
    ["2026-10-24T09:00:00+09:00", true],
    ["2026-10-24T00:00:00.123456789012345678Z", true],
    ["9999-12-31T23:59:59-23:59", true],
    ["0000-01-01T00:00:00Z", false],
    ["1900-02-29T00:00:00Z", false],
    ["2026-02-29T00:00:00Z", false],
    ["2026-04-31T00:00:00Z", false],
    ["2026-10-24T24:00:00Z", false],
    ["2026-10-24T23:59:60Z", false],
    ["2026-10-24T00:00:00-00:00", false],
    ["2026-10-24T00:00:00+24:00", false],
    ["2026-10-24T00:00:00+09:60", false],
    ["2026-10-24T00:00:00", false],
    ["2026-10-24T00:00:00z", false],
    ["2026-10-24T00:00:00.Z", false],
  ] as const;
  for (const [claimed, accepted] of cases) {
    assert.equal(validForwardV02ClaimedInstant(claimed), accepted, claimed);
    const digest = forwardV02SourceManifestReferenceDigest(manifest(claimed));
    assert.equal(digest !== null, accepted, "manifest parity: " + claimed);
  }
});

test("manifest digest binds claimed timestamp bytes, not merely normalized UTC instant", () => {
  const utc = "2026-10-24T00:00:00.000000001Z";
  const jst = "2026-10-24T09:00:00.000000001+09:00";
  assert.equal(compareForwardV02ClaimedInstants(utc, jst), 0);
  const a = forwardV02SourceManifestReferenceDigest(manifest(utc));
  const b = forwardV02SourceManifestReferenceDigest(manifest(jst));
  assert.equal(typeof a, "string");
  assert.equal(typeof b, "string");
  assert.notEqual(a, b, "different caller claims must not alias a content-addressed manifest");
});

test("claimed chronology remains ordered across offset-induced year-boundary crossings", () => {
  const beforeYearOne = "0001-01-01T00:00:00+23:59";
  const yearOneUtc = "0001-01-01T00:00:00Z";
  const lastYearUtc = "9999-12-31T23:59:59Z";
  const afterLastYear = "9999-12-31T23:59:59-23:59";
  for (const claimed of [beforeYearOne, yearOneUtc, lastYearUtc, afterLastYear]) {
    assert.equal(validForwardV02ClaimedInstant(claimed), true, claimed);
  }
  assert.equal(compareForwardV02ClaimedInstants(beforeYearOne, yearOneUtc), -1);
  assert.equal(compareForwardV02ClaimedInstants(yearOneUtc, beforeYearOne), 1);
  assert.equal(compareForwardV02ClaimedInstants(lastYearUtc, afterLastYear), -1);
  assert.equal(compareForwardV02ClaimedInstants(afterLastYear, lastYearUtc), 1);
});
