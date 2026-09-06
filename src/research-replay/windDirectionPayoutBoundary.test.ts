import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("wind direction venue screen fails closed on DB identity and exacta settlement coverage", () => {
  const source = readFileSync("scripts/analyze-wind-direction-by-venue.ts", "utf8");
  const coverageIndex = source.indexOf("assertSettlementCompleteness();");
  const analysisIndex = source.indexOf("const raws = db.prepare");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /WIND_DIRECTION_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /WIND_DIRECTION_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(analysisIndex > coverageIndex, "ROI analysis must not start before settlement coverage passes");
});
