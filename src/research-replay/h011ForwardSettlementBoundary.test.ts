import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-h011-forward-monitor.ts", "utf8");
const raw = readFileSync("scripts/report-h011-forward-monitor-raw.ts", "utf8");
const internal = readFileSync("scripts/report-h011-forward-monitor-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("H011 forward monitor validates exacta settlement integrity and DB handoff before aggregation", () => {
  assert.equal(pkg.scripts?.["report:h011-forward-monitor"], "tsx scripts/report-h011-forward-monitor.ts");
  assert.match(entry, /H011_FORWARD_PRIMARY_DB_MISSING/);
  assert.match(entry, /H011_FORWARD_HANDOFF_DB_MISSING/);
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
  assert.match(entry, /H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(entry, /BOAT_PON_DB_PATH: handoffDbPath/);

  const gate = entry.indexOf("H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED");
  const handoff = entry.indexOf("H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID");
  const run = entry.indexOf("report-h011-forward-monitor-raw.ts");
  assert.ok(gate >= 0 && handoff > gate, "database identity must be reverified after settlement integrity passes");
  assert.ok(run > handoff, "guarded raw handoff must start only after DB handoff revalidation");
  assert.equal(entry.includes("report-h011-forward-monitor-internal.ts"), false);
});

test("H011 forward raw compatibility module revalidates DB identity and forbids direct CLI execution", () => {
  const directGuard = raw.indexOf("H011_FORWARD_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identity = raw.indexOf("H011_FORWARD_RAW_DB_IDENTITY_INVALID");
  const internalImport = raw.indexOf('await import("./report-h011-forward-monitor-internal")');

  assert.ok(directGuard >= 0 && identity > directGuard && internalImport > identity);
  assert.match(raw, /H011_FORWARD_RAW_DB_MISSING/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{/);
});

test("H011 forward implementation remains read-only behind the guarded command", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});