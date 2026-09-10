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

const optionalDecisionReports = [
  "reports/wind24-exh1-switch-deep-dive.json",
];

test("ROI governor fails closed on missing, non-canonical, or invalid decision-critical reports before raw phase generation", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(path, identityError\)/u);
  assert.match(entry, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/);
  assert.match(entry, /!isObject\(parsed\)/);
  assert.match(entry, /validateDecisionCriticalShape\(path, parsed\)/);
  const validation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true)');
  const identity = entry.indexOf("ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID");
  const shape = entry.indexOf("validateDecisionCriticalShape(path, parsed)");
  const rawRun = entry.indexOf('await import("./report-roi-governor-raw")');
  assert.ok(validation >= 0 && identity >= 0 && shape >= 0 && rawRun > validation);
  assert.equal(pkg.scripts?.["report:roi-governor"], "tsx scripts/report-roi-governor.ts");
});

test("ROI governor revalidates decision-critical report identity and shape immediately before in-process raw handoff", () => {
  const initialValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true)');
  const handoffValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID", true)');
  const rawImport = entry.indexOf('await import("./report-roi-governor-raw")');

  assert.ok(initialValidation >= 0 && handoffValidation > initialValidation && rawImport > handoffValidation);
  assert.equal(entry.includes("spawnSync"), false);
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID/);
});

test("ROI governor validates present higher-precedence deep-dive evidence before it can override monitor measurements", () => {
  for (const path of optionalDecisionReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(raw, /const n\s+= dd\?\.periods\.fwdAll\.n \?\? swMon\?\.forward\.n/);
  assert.match(raw, /const top2ExclRoi\s+= dd\?\.excludeMax\.forward\.top2Roi \?\? swMon\?\.upgradeCheck\.top2ExclRoi/);
  assert.match(raw, /const nReached200\s+= dd\?\.upgradeStatus\.nReached200 \?\? false/);
  assert.match(raw, /const top2RoiOk\s+= dd\?\.upgradeStatus\.top2RoiOk \?\? false/);

  assert.match(entry, /validateWind24DeepDive/);
  assert.match(entry, /\["periods", "fwdAll", "n"\]/);
  assert.match(entry, /\["excludeMax", "forward", "top2Roi"\]/);
  assert.match(entry, /\["upgradeStatus", "nForUpgrade"\]/);
  assert.match(entry, /\["upgradeStatus", "nReached200"\]/);
  assert.match(entry, /\["upgradeStatus", "top2RoiOk"\]/);
  assert.match(entry, /\["upgradeStatus", "recentZeroCount"\]/);
  assert.match(entry, /ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_IDENTITY_INVALID/);
});

test("ROI governor revalidates present optional decision evidence immediately before raw handoff", () => {
  const initialValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_IDENTITY_INVALID", false)');
  const handoffValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID", false)');
  const rawImport = entry.indexOf('await import("./report-roi-governor-raw")');

  assert.ok(initialValidation >= 0 && handoffValidation > initialValidation && rawImport > handoffValidation);
  assert.match(entry, /if \(required\) fail\(path, "missing"\)/);
  assert.match(entry, /ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID/);
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

test("raw ROI governor retains optional non-authoritative evidence fallbacks only behind the decision-critical input gate", () => {
  assert.match(raw, /reports\/wind24-exh1-switch-deep-dive\.json/);
  assert.match(raw, /reports\/paper-forward-candidates\.json/);
  assert.match(raw, /function determinePhase/);
});
