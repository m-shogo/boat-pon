import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-h011-forward-monitor.ts", "utf8");
const internal = readFileSync("scripts/report-h011-forward-monitor-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("H011 forward monitor validates exacta settlement integrity before aggregation", () => {
  assert.equal(pkg.scripts?.["report:h011-forward-monitor"], "tsx scripts/report-h011-forward-monitor.ts");
  assert.match(entry, /H011_FORWARD_PRIMARY_DB_MISSING/);
  assert.doesNotMatch(entry, /DB not found: \$\{DB_PATH\}/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile/);
  assert.match(entry, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entry, /PRAGMA query_only=ON/);
  assert.match(entry, /rp\.bet_type='exacta'/);
  assert.match(entry, /rp\.returned=0/);
  assert.match(entry, /rp\.combination!=''/);
  assert.match(entry, /rp\.payout_yen>0/);
  assert.match(entry, /line_count=1 AND valid_count=1/);
  assert.match(entry, /integrity\.ambiguous !== 0/);
  assert.match(entry, /H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED/);

  const gate = entry.indexOf("H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED");
  const run = entry.indexOf("report-h011-forward-monitor-internal.ts");
  assert.ok(gate >= 0 && run > gate, "aggregation must start only after settlement integrity passes");
});

test("H011 forward implementation remains read-only behind the guarded command", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});
