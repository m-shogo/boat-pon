import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-123-bet-type-conversion.ts", "utf-8");
const audit = readFileSync("scripts/audit-123-bet-type-conversion-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("123 bet-type conversion command fails closed before cross-bet analysis", () => {
  assert.equal(pkg.scripts?.["analyze:123-bet-type-conversion"], "tsx scripts/analyze-123-bet-type-conversion.ts");
  const preflight = entrypoint.indexOf('run("scripts/audit-123-bet-type-conversion-completeness.ts")');
  const core = entrypoint.indexOf('run("scripts/analyze-123-bet-type-conversion-core.ts")');
  assert.ok(preflight >= 0);
  assert.ok(core > preflight, "cross-bet analysis must remain downstream of the completeness preflight");
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-123-bet-type-conversion-core.ts")), false);
});

test("123 bet-type preflight requires every settlement type compared by the analyzer", () => {
  for (const betType of ["trifecta", "trio", "exacta", "quinella", "wide"]) {
    assert.ok(audit.includes(`"${betType}"`), `missing required bet type: ${betType}`);
  }
  assert.match(audit, /payout_yen IS NOT NULL/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /process\.exit\(2\)/);
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
