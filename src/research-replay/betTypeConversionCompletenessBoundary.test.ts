import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-123-bet-type-conversion.ts", "utf-8");
const core = readFileSync("scripts/analyze-123-bet-type-conversion-core.ts", "utf-8");
const internal = readFileSync("scripts/analyze-123-bet-type-conversion-internal.ts", "utf-8");
const audit = readFileSync("scripts/audit-123-bet-type-conversion-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("123 bet-type conversion command fails closed before guarded cross-bet analysis", () => {
  assert.equal(pkg.scripts?.["analyze:123-bet-type-conversion"], "tsx scripts/analyze-123-bet-type-conversion.ts");
  const preflight = entrypoint.indexOf('run("scripts/audit-123-bet-type-conversion-completeness.ts")');
  const analysis = entrypoint.indexOf('await import("./analyze-123-bet-type-conversion-core")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight, "cross-bet analysis must remain downstream of the completeness preflight");
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-123-bet-type-conversion-core.ts")), false);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-123-bet-type-conversion-internal.ts")), false);
});

test("123 bet-type conversion core cannot bypass the canonical settlement preflight", () => {
  assert.match(core, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(core, /process\.argv\[1\]/);
  assert.match(core, /BET_TYPE_CONVERSION_CORE_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(core, /await import\("\.\/analyze-123-bet-type-conversion-internal"\)/);
  assert.doesNotMatch(core, /new DatabaseSync/);
  assert.match(internal, /race_payouts/);
  assert.match(internal, /switch候補/);
});

test("123 bet-type preflight rejects returned or unknown-return historical BUY rows before coverage analysis", () => {
  assert.match(audit, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(audit, /target historical BUY cohort contains returned or unknown-return rows/);
  const returnGate = audit.indexOf("const invalidReturnState = db.prepare");
  const coverage = audit.indexOf("const row = db.prepare");
  assert.ok(returnGate >= 0 && coverage > returnGate, "return-state integrity must gate coverage analysis");
  assert.match(audit, /WHERE \$\{populationWhere\}[\s\S]*AND dh\.returned = 0/);
});

test("123 bet-type preflight requires every settlement type compared by the analyzer", () => {
  for (const betType of ["trifecta", "trio", "exacta", "quinella", "wide"]) {
    assert.ok(audit.includes(`"${betType}"`), `missing required bet type: ${betType}`);
  }
  assert.match(audit, /rp\.returned = 0/);
  assert.match(audit, /rp\.payout_yen > 0/);
  assert.match(audit, /TRIM\(COALESCE\(rp\.combination, ''\)\) != ''/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /process\.exit\(2\)/);
});

test("123 bet-type preflight rejects malformed, unknown-return, refunded, and duplicate settlement keys", () => {
  assert.match(audit, /WITH population AS/);
  assert.match(audit, /SELECT DISTINCT dh\.race_id/);
  assert.match(audit, /returned IS NULL/);
  assert.match(audit, /returned != 0/);
  assert.match(audit, /payout_yen IS NULL/);
  assert.match(audit, /payout_yen <= 0/);
  assert.match(audit, /TRIM\(COALESCE\(combination, ''\)\) = ''/);
  assert.match(audit, /GROUP BY race_id, bet_type, combination/);
  assert.match(audit, /HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /process\.exit\(3\)/);
});

test("123 bet-type integrity remains per combination so legitimate multi-line races are allowed", () => {
  assert.doesNotMatch(audit, /GROUP BY race_id, bet_type\s*\n\s*HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /GROUP BY race_id, bet_type, combination/);
});

test("123 bet-type preflight matches the analyzer population and keeps SQLite read-only", () => {
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /EXCLUDED_VENUES/);
  assert.match(audit, /EXCLUDED_RACE_NOS/);
  const verify = audit.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = audit.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(audit, /PRAGMA query_only = ON/);
});
