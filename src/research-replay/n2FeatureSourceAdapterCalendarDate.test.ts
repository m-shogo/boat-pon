import assert from "node:assert/strict";
import test from "node:test";
import { adaptLiveOddsRows, adaptOfficialProgramFeatures } from "./n2FeatureSourceAdapter";

test("rejects impossible calendar dates before trusting program lineage", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1",
    rawJson: "{}",
    sourceFile: "fixture.json",
    importedAt: "2026-02-30T12:00:00Z",
    lineage: null,
  });

  assert.deepEqual(result, {
    status: "excluded",
    reason: "excluded_invalid_program_imported_at",
  });
});

test("rejects impossible calendar dates before trusting odds lineage", () => {
  const result = adaptLiveOddsRows({
    expectedBetType: "trifecta",
    rows: [{
      id: 1,
      raceId: "race-1",
      betType: "trifecta",
      betSelection: "1-2-3",
      odds: 12.3,
      capturedAt: "2026-04-31T09:30:00+09:00",
      source: "fixture",
      lineage: null,
    }],
  });

  assert.deepEqual(result, {
    status: "excluded",
    reason: "excluded_invalid_odds_captured_at",
  });
});

test("keeps valid leap-day timestamps eligible for normal lineage validation", () => {
  const result = adaptLiveOddsRows({
    expectedBetType: "trifecta",
    rows: [{
      id: 1,
      raceId: "race-1",
      betType: "trifecta",
      betSelection: "1-2-3",
      odds: 12.3,
      capturedAt: "2028-02-29T09:30:00+09:00",
      source: "fixture",
      lineage: null,
    }],
  });

  assert.deepEqual(result, {
    status: "excluded",
    reason: "excluded_unverified_odds_lineage",
  });
});
