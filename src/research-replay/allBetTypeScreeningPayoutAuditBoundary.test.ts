import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("all-bet-type screening payout audit accepts legitimate multi-line settlements but rejects malformed lines", () => {
  const source = readFileSync("scripts/audit-all-bet-type-screening-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /dh\.returned = 0/);
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /ALL_BET_TYPE_SCREENING_RETURNED_BUY_UNSUPPORTED/);
  assert.match(source, /GROUP BY rp\.race_id, rp\.bet_type/);
  assert.match(source, /COUNT\(\*\) >= 1/);
  assert.match(source, /COUNT\(\*\) = COUNT\(DISTINCT rp\.combination\)/);
  assert.match(source, /rp\.returned = 1 OR rp\.payout_yen > 0/);
  assert.doesNotMatch(source, /SELECT DISTINCT rp\.race_id, rp\.bet_type/);
  assert.doesNotMatch(source, /COUNT\(\*\) = 1/);
});

test("all-bet-type screening fails closed on unknown return state before settlement coverage", () => {
  const source = readFileSync("scripts/audit-all-bet-type-screening-payout-completeness.ts", "utf8");
  const unknownReturn = source.indexOf("dh.returned IS NULL OR dh.returned != 0");
  const guard = source.indexOf("ALL_BET_TYPE_SCREENING_RETURNED_BUY_UNSUPPORTED");
  const coverage = source.indexOf("WITH population AS");

  assert.ok(unknownReturn >= 0);
  assert.ok(guard > unknownReturn);
  assert.ok(coverage > guard, "unknown/returned BUY rows must be rejected before payout coverage can be accepted");
});

test("all-bet-type screening payout audit pins return-state validation and coverage to one read snapshot", () => {
  const source = readFileSync("scripts/audit-all-bet-type-screening-payout-completeness.ts", "utf8");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const begin = source.indexOf('db.exec("BEGIN;")');
  const returnState = source.indexOf("const invalidReturnedBuy = db.prepare");
  const coverage = source.indexOf("const rows = db.prepare");

  assert.ok(queryOnly >= 0);
  assert.ok(begin > queryOnly);
  assert.ok(returnState > begin);
  assert.ok(coverage > returnState);
});

test("normal all-bet-type screening entrypoint cannot bypass payout audit or DB revalidation", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  const runner = readFileSync("scripts/run-all-bet-type-screening-safe.ts", "utf8");

  assert.equal(pkg.scripts["analyze:all-bet-type-screening"], "tsx scripts/run-all-bet-type-screening-safe.ts");
  assert.match(runner, /run\(auditPath\)/);
  assert.match(runner, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(runner, /run\(analyzerPath, \{/);
  const audit = runner.indexOf("run(auditPath);");
  const reverify = runner.indexOf('assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID")');
  const analyzer = runner.indexOf("run(analyzerPath, {");
  assert.ok(audit >= 0 && reverify > audit && analyzer > reverify);
});

test("all-bet-type screening analyzer publishes only verified staged outputs through atomic destinations", () => {
  const runner = readFileSync("scripts/run-all-bet-type-screening-safe.ts", "utf8");

  assert.match(runner, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-all-bet-screening-"\)\)/);
  assert.match(runner, /cwd: workspace/);
  assert.match(runner, /BOAT_PON_DB_PATH: verifiedDbPath/);
  assert.match(runner, /assertCanonicalSingleLinkRegularFile\(\s*stagedPath,/);
  assert.match(runner, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(runner, /fsyncSync\(fd\)/);
  assert.match(runner, /assertCanonicalSingleLinkRegularFile\(\s*path,\s*`ALL_BET_TYPE_SCREENING_\$\{code\}_PUBLISH_DESTINATION_IDENTITY_INVALID`/);
  assert.match(runner, /renameSync\(verifiedTempPath, path\)/);
  const staged = runner.indexOf("const verifiedStagedPath = assertCanonicalSingleLinkRegularFile");
  const publish = runner.indexOf("atomicPublish(output.destination");
  assert.ok(staged >= 0 && publish > staged);
});
