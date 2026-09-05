import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync("scripts/audit-condb-switch-historical-payout-completeness.ts", "utf8");
const runner = readFileSync("scripts/run-condb-switch-historical-closing-odds-safe.ts", "utf8");

test("condB historical payout preflight uses verified read-only official trifecta settlements", () => {
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH/);
  assert.match(preflight, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.match(preflight, /FROM race_payouts rp/);
  assert.match(preflight, /rp\.bet_type = 'trifecta'/);
  assert.match(preflight, /dh\.decision = 'BUY'/);
  assert.match(preflight, /dh\.run_kind = 'historical-backfill'/);
  assert.match(preflight, /dh\.selection = '1-2-3'/);
  assert.match(preflight, /dh\.date >= \?/);
});

test("condB historical payout preflight fails closed on empty or incomplete coverage", () => {
  assert.match(preflight, /total <= 0/);
  assert.match(preflight, /covered > total/);
  assert.match(preflight, /if \(missing !== 0\)/);
  assert.match(preflight, /process\.exit\(2\)/);
});

test("safe runner executes payout preflight before the legacy analyzer", () => {
  const audit = runner.indexOf("audit-condb-switch-historical-payout-completeness.ts");
  const analyzer = runner.indexOf("analyze-condb-switch-historical-closing-odds.ts");
  assert.ok(audit >= 0);
  assert.ok(analyzer > audit);
  assert.doesNotMatch(runner, /try\s*\{[\s\S]*audit-condb-switch-historical-payout-completeness/);
});
