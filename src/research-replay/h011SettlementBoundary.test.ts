import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-h011-implied-vs-frequency.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("H011 verdict cannot run before canonical settlement coverage and DB handoff verification pass", () => {
  assert.equal(pkg.scripts?.["analyze:h011-implied-vs-frequency"], "tsx scripts/analyze-h011-implied-vs-frequency.ts");
  assert.match(source, /throw new Error\("H011_PRIMARY_DB_MISSING"\)/);
  assert.doesNotMatch(source, /H011_PRIMARY_DB_MISSING \$\{DB_PATH\}/);
  assert.match(source, /H011_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /dh\.run_kind='historical-backfill'/);
  assert.match(source, /dh\.selection='1-2-3'/);
  assert.match(source, /HAVING COUNT\(\*\)=30 AND has_f=0/);
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /rp\.returned=0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /H011_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /settled !== total/);
  assert.match(source, /total <= 0/);
  assert.match(source, /winner_h\.combination=rp\.combination/);
  assert.match(source, /H011_DB_HANDOFF_IDENTITY_INVALID/);

  const coverageIndex = source.indexOf("H011_EXACTA_PAYOUT_COVERAGE_INCOMPLETE");
  const closeIndex = source.lastIndexOf("db.close();");
  const handoffIndex = source.indexOf("const handoffDbPath = assertCanonicalSingleLinkRegularFile", closeIndex);
  const envIndex = source.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath", handoffIndex);
  const analysisIndex = source.indexOf('await import("./analyze-h011-implied-vs-frequency-raw")');
  assert.ok(coverageIndex >= 0, "settlement coverage gate must exist");
  assert.ok(closeIndex > coverageIndex, "preflight DB must close after coverage validation");
  assert.ok(handoffIndex > closeIndex, "DB identity must be revalidated after preflight closes");
  assert.ok(envIndex > handoffIndex, "raw analyzer must receive only the reverified DB path");
  assert.ok(analysisIndex > envIndex, "H011 verdict analysis must not run before DB handoff verification passes");
});