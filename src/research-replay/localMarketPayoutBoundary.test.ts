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

test("local market settlement gate rejects ambiguous multi-line exacta winners", () => {
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /rp\.returned=0/);
  assert.match(source, /rp\.combination IS NOT NULL AND rp\.combination!=''/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /THEN 1 ELSE 0 END\)=1/);
  assert.doesNotMatch(source, /CASE WHEN COUNT\(\*\)>=1/);
});

test("local market entrypoint does not expose configured database paths in missing-db errors", () => {
  assert.match(source, /throw new Error\("LOCAL_MARKET_PRIMARY_DB_MISSING"\)/);
  assert.doesNotMatch(source, /LOCAL_MARKET_PRIMARY_DB_MISSING \$\{DB_PATH\}/);
});