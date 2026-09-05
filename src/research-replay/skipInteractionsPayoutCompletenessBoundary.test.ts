import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf-8");
const audit = readFileSync("scripts/audit-roi-skip-interactions-payout-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-interactions command cannot bypass settlement completeness", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-interactions"], "tsx scripts/analyze-roi-skip-interactions.ts");
  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const core = entrypoint.indexOf('run("scripts/analyze-roi-skip-interactions-core.ts")');
  assert.ok(preflight >= 0);
  assert.ok(core > preflight);
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-roi-skip-interactions-core.ts")), false);
});

test("skip-interactions preflight matches the exact forward population", () => {
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.current_odds IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /dh\.date >= '\$\{FORWARD_START\}'/);
  assert.match(audit, /EXCLUDED_VENUES/);
  assert.match(audit, /EXCLUDED_RACE_NOS/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /rp\.payout_yen IS NOT NULL/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /process\.exit\(2\)/);
});

test("skip-interactions preflight verifies DB identity before read-only SQLite open", () => {
  const verify = audit.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = audit.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(audit, /PRAGMA query_only = ON/);
});
