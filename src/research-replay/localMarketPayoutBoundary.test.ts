import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-local-market-anomalies-safe.ts", "utf8");

test("local market anomaly launcher fails closed before analysis", () => {
  assert.match(source, /LOCAL_MARKET_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /LOCAL_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.match(source, /total <= 0/);
  assert.match(source, /winner_h\.combination=rp\.combination/);

  const coverageIndex = source.indexOf("LOCAL_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE");
  const analysisIndex = source.indexOf('await import("./analyze-local-market-anomalies.ts")');
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(analysisIndex > coverageIndex, "analysis must not run before settlement coverage passes");
});
