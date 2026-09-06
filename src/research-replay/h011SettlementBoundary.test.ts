import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-h011-implied-vs-frequency-safe.ts", "utf8");

test("H011 verdict cannot run before canonical settlement coverage passes", () => {
  assert.match(source, /H011_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /dh\.run_kind='historical-backfill'/);
  assert.match(source, /dh\.selection='1-2-3'/);
  assert.match(source, /HAVING COUNT\(\*\)=30 AND has_f=0/);
  assert.match(source, /H011_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.match(source, /total <= 0/);
  assert.match(source, /winner_h\.combination=rp\.combination/);

  const coverageIndex = source.indexOf("H011_EXACTA_PAYOUT_COVERAGE_INCOMPLETE");
  const analysisIndex = source.indexOf('await import("./analyze-h011-implied-vs-frequency")');
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(analysisIndex > coverageIndex, "H011 verdict analysis must not run before settlement coverage passes");
});
