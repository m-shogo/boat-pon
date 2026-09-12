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
  assert.match(entry, /JSON\.parse\(contents\)/);
  assert.match(entry, /!isObject\(parsed\)/);
  assert.match(entry, /validateDecisionCriticalShape\(path, parsed\)/);
  const validation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true)');
  const identity = entry.indexOf("ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID");
  const shape = entry.indexOf("validateDecisionCriticalShape(path, parsed)");
  const rawRun = entry.indexOf("spawnSync(process.execPath");
  assert.ok(validation >= 0 && identity >= 0 && shape >= 0 && rawRun > validation);
  assert.equal(pkg.scripts?.["report:roi-governor"], "tsx scripts/report-roi-governor.ts");
});

test("ROI governor revalidates decision-critical report identity and shape immediately before isolated raw handoff", () => {
  const initialValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true)');
  const handoffValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID", true)');
  const rawSpawn = entry.indexOf("spawnSync(process.execPath");

  assert.ok(initialValidation >= 0 && handoffValidation > initialValidation && rawSpawn > handoffValidation);
  assert.match(entry, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-roi-governor-"\)\)/);
  assert.match(entry, /cwd: workspace/);
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

test("ROI governor revalidates optional decision and context evidence immediately before isolated raw handoff", () => {
  const initialValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_IDENTITY_INVALID", false)');
  const handoffValidation = entry.indexOf('validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID", false)');
  const contextHandoff = entry.indexOf('validateReport(path, "ROI_GOVERNOR_OPTIONAL_CONTEXT_REPORT_HANDOFF_IDENTITY_INVALID", false, false)');
  const rawSpawn = entry.indexOf("spawnSync(process.execPath");

  assert.ok(initialValidation >= 0 && handoffValidation > initialValidation && contextHandoff > handoffValidation && rawSpawn > contextHandoff);
  assert.match(entry, /if \(required\) fail\(path, "missing"\)/);
  assert.match(entry, /ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID/);
  assert.match(entry, /reports\/paper-forward-candidates\.json/);
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

test("ROI governor publishes only verified isolated outputs through fsynced temp files and atomic rename", () => {
  const rawSpawn = entry.indexOf("spawnSync(process.execPath");
  const stagedIdentity = entry.indexOf("ROI_GOVERNOR_JSON_OUTPUT_IDENTITY_INVALID");
  const tempIdentity = entry.indexOf("const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationIdentity = entry.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)");
  const rename = entry.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(rawSpawn >= 0 && stagedIdentity > rawSpawn);
  assert.ok(tempIdentity >= 0 && destinationIdentity > tempIdentity && rename > destinationIdentity);
  assert.match(entry, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entry, /fsyncSync\(fd\)/);
  assert.match(entry, /ROI_GOVERNOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entry, /ROI_GOVERNOR_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.equal(entry.includes('await import("./report-roi-governor-raw")'), false);
});

test("raw ROI governor retains optional non-authoritative evidence fallbacks only behind the guarded entrypoint", () => {
  assert.match(raw, /reports\/wind24-exh1-switch-deep-dive\.json/);
  assert.match(raw, /reports\/paper-forward-candidates\.json/);
  assert.match(raw, /function determinePhase/);
});
