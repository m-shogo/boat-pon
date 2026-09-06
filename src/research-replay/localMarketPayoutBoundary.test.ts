import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-local-market-anomalies.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("local market anomaly entrypoint fails closed before raw analysis", () => {
  assert.equal(pkg.scripts?.["analyze:local-market-anomalies"], "tsx scripts/analyze-local-market-anomalies.ts");
  assert.match(source, /LOCAL_MARKET_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /LOCAL_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.match(source, /total <= 0/);
  assert.match(source, /winner_h\.combination=rp\.combination/);

  const coverageIndex = source.indexOf("LOCAL_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE");
  const analysisIndex = source.indexOf('await import("./analyze-local-market-anomalies-raw")');
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(analysisIndex > coverageIndex, "raw analysis must not run before settlement coverage passes");
});
