import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("all-bet-types payout audit is canonical read-only and validates complete official settlement lines", () => {
  const source = readFileSync("scripts/audit-all-bet-types-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /GROUP BY rp\.race_id, rp\.bet_type/);
  assert.match(source, /HAVING COUNT\(\*\) >= 1/);
  assert.match(source, /COUNT\(DISTINCT rp\.combination\) = COUNT\(\*\)/);
  assert.match(source, /SUM\(CASE WHEN rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0 THEN 1 ELSE 0 END\) = COUNT\(\*\)/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 1/);
  assert.match(source, /ALL_BET_TYPES_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /total <= 0/);
  assert.match(source, /settled !== total/);
});

test("direct all-bet-types ROI entrypoint cannot bypass payout completeness audit", () => {
  const source = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gateIndex = source.indexOf("audit !== 0");
  const rawIndex = source.indexOf("analyze-all-bet-types-roi-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(gateIndex > auditIndex);
  assert.ok(rawIndex > gateIndex);
  assert.doesNotMatch(source, /DatabaseSync/);
});

test("legacy safe all-bet-types runner audits before invoking raw analyzer", () => {
  const source = readFileSync("scripts/run-all-bet-types-roi-safe.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const rawIndex = source.indexOf("analyze-all-bet-types-roi-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(rawIndex > auditIndex);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi\.ts/);
});

test("npm all-bet-types ROI alias points at the guarded normal entrypoint", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["analyze:all-bet-types-roi"], "tsx scripts/analyze-all-bet-types-roi.ts");
});
