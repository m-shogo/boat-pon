import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-roi-governor.ts", "utf8");
const raw = readFileSync("scripts/report-roi-governor-raw.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const requiredReports = [
  "reports/paper-forward-monitor.json",
  "reports/ticket-selector-strategies.json",
  "reports/roi-skip-policy-simulation.json",
];

test("ROI governor fails closed on missing, non-canonical, or invalid decision-critical reports before raw phase generation", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(\s*path,/u);
  assert.match(entry, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/);
  assert.match(entry, /!isObject\(parsed\)/);
  assert.match(entry, /validateDecisionCriticalShape\(path, parsed\)/);
  const validation = entry.indexOf("for (const path of REQUIRED_REPORTS)");
  const identity = entry.indexOf("ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID");
  const shape = entry.indexOf("validateDecisionCriticalShape(path, parsed)");
  const rawRun = entry.indexOf("report-roi-governor-raw.ts");
  assert.ok(validation >= 0 && identity > validation && shape > identity && rawRun > shape);
  assert.equal(pkg.scripts?.["report:roi-governor"], "tsx scripts/report-roi-governor.ts");
});

test("ROI governor validates measured readiness counts and ROI inputs instead of trusting object shape alone", () => {
  assert.match(entry, /missing_required_switch:sw_wind24_exh1/);
  assert.match(entry, /requireNonNegativeInteger\(reportPath, condB, \["forward", "n"\]\)/);
  assert.match(entry, /requireNonNegativeInteger\(reportPath, condB, \["upgradeCheck", "nToUpgrade"\]\)/);
  assert.match(entry, /requireNonNegativeInteger\(reportPath, condB, \["upgradeCheck", "recentZeroMonths"\]\)/);
  assert.match(entry, /requireNonNegativeInteger\(reportPath, parsed, \["baseline", "n"\]\)/);
  assert.match(entry, /requireNonNegativeInteger\(reportPath, parsed, \["baseline", "hits"\]\)/);
  assert.match(entry, /\["baseline", "roi"\]/);
  assert.match(entry, /\["selectors", "onePt", "forward", "roi"\]/);
  assert.match(entry, /\["selectors", "multiPt", "forward", "roi"\]/);
  assert.match(entry, /Number\.isSafeInteger\(value\)/);
  assert.match(entry, /value < 0/);
  assert.match(entry, /Number\.isFinite\(value\)/);
});

test("raw ROI governor retains optional evidence fallbacks only behind the decision-critical input gate", () => {
  assert.match(raw, /reports\/wind24-exh1-switch-deep-dive\.json/);
  assert.match(raw, /reports\/paper-forward-candidates\.json/);
  assert.match(raw, /function determinePhase/);
});
