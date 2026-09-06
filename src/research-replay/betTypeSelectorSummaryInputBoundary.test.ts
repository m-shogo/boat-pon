import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");
const raw = readFileSync("scripts/report-bet-type-selector-summary-raw.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const requiredReports = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
];

test("bet-type selector summary fails closed on missing or invalid prerequisite reports before raw summary", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/);
  assert.match(entry, /parsed === null \|\| typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  const validation = entry.indexOf("for (const path of REQUIRED_REPORTS)");
  const rawRun = entry.indexOf("report-bet-type-selector-summary-raw.ts");
  assert.ok(validation >= 0 && rawRun > validation);
  assert.doesNotMatch(entry, /DatabaseSync/);
  assert.equal(pkg.scripts?.["report:bet-type-selector"], "tsx scripts/report-bet-type-selector-summary.ts");
});

test("raw selector summary retains canonical read-only research DB boundary", () => {
  assert.match(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.match(raw, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(raw, /PRAGMA query_only=ON/);
});
