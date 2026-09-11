import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("all-bet-types payout audit is canonical read-only and validates complete official settlement lines", () => {
  const source = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/);
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /ALL_BET_TYPES_BUY_COHORT_UNSUPPORTED/);
  assert.match(source, /dh\.bet_type='3連単'/);
  assert.match(source, /dh\.returned = 0/);
  assert.match(source, /GROUP BY rp\.race_id, rp\.bet_type/);
  assert.match(source, /HAVING COUNT\(\*\) >= 1/);
  assert.match(source, /COUNT\(DISTINCT rp\.combination\) = COUNT\(\*\)/);
  assert.match(source, /SUM\(CASE WHEN rp\.returned = 0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0 THEN 1 ELSE 0 END\) = COUNT\(\*\)/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 1/);
  assert.match(source, /ALL_BET_TYPES_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /total <= 0/);
  assert.match(source, /settled !== total/);
});

test("all-bet-types payout audit fails closed on bet-type or return-state drift before settlement coverage", () => {
  const source = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");
  const invalidCohort = source.indexOf("dh.bet_type IS NULL OR dh.bet_type != '3連単' OR dh.returned IS NULL OR dh.returned != 0");
  const guard = source.indexOf("ALL_BET_TYPES_BUY_COHORT_UNSUPPORTED");
  const coverage = source.indexOf("WITH population AS");

  assert.ok(invalidCohort >= 0);
  assert.ok(guard > invalidCohort);
  assert.ok(coverage > guard, "unsupported BUY cohort rows must be rejected before payout coverage can be accepted");
});

test("all-bet-types payout audit pins cohort validation and coverage to one read snapshot", () => {
  const source = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const begin = source.indexOf('db.exec("BEGIN;")');
  const cohort = source.indexOf("const invalidBuyCohort = db.prepare");
  const coverage = source.indexOf("const rows = db.prepare");

  assert.ok(queryOnly >= 0);
  assert.ok(begin > queryOnly);
  assert.ok(cohort > begin);
  assert.ok(coverage > cohort);
});

test("direct all-bet-types ROI entrypoint cannot bypass payout completeness audit", () => {
  const source = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gateIndex = source.indexOf("audit !== 0");
  const handoffIndex = source.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = source.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalIndex = source.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(auditIndex >= 0);
  assert.ok(gateIndex > auditIndex);
  assert.ok(handoffIndex > gateIndex);
  assert.ok(launchIdentity > handoffIndex);
  assert.ok(internalIndex > launchIdentity);
  assert.match(source, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi-raw/);
  assert.doesNotMatch(source, /DatabaseSync/);
});

test("legacy safe all-bet-types runner delegates to the canonical fail-closed entrypoint", () => {
  const source = readFileSync("scripts/run-all-bet-types-roi-safe.ts", "utf8");

  assert.match(source, /scripts\/analyze-all-bet-types-roi\.ts/);
  assert.doesNotMatch(source, /audit-all-bet-types-payout-completeness\.ts/);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi-internal\.ts/);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi-raw\.ts/);
});

test("npm all-bet-types ROI alias points at the guarded normal entrypoint", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["analyze:all-bet-types-roi"], "tsx scripts/analyze-all-bet-types-roi.ts");
});
