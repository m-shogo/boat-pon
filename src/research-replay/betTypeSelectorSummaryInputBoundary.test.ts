import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");
const raw = readFileSync("scripts/report-bet-type-selector-summary-raw.ts", "utf8");
const internal = readFileSync("scripts/report-bet-type-selector-summary-internal.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const requiredReports = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
];

test("bet-type selector summary fails closed on missing, non-canonical, invalid, or point-in-time-unsafe prerequisite reports before internal summary", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*path,/u);
  assert.match(entry, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/);
  assert.match(entry, /parsed === null \|\| typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  assert.match(entry, /envelope\.safety\?\.pointInTimeSafe === false/);
  assert.match(entry, /point_in_time_unsafe/);
  const validation = entry.indexOf("for (const path of REQUIRED_REPORTS)");
  const identity = entry.indexOf("BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID");
  const safetyValidation = entry.indexOf("pointInTimeSafe === false");
  const internalRun = entry.indexOf("report-bet-type-selector-summary-internal.ts");
  assert.ok(validation >= 0 && identity > validation && safetyValidation > identity && internalRun > safetyValidation);
  assert.doesNotMatch(entry, /report-bet-type-selector-summary-raw\.ts/);
  assert.doesNotMatch(entry, /DatabaseSync/);
  assert.equal(pkg.scripts?.["report:bet-type-selector"], "tsx scripts/report-bet-type-selector-summary.ts");
});

test("legacy raw selector summary path cannot bypass prerequisite report validation", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /BET_TYPE_SELECTOR_SUMMARY_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/report-bet-type-selector-summary-internal"\)/);
});

test("internal selector summary retains canonical read-only research DB boundary", () => {
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only=ON/);
});
