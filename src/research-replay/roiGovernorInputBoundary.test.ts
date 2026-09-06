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

test("ROI governor fails closed on missing or invalid decision-critical reports before raw phase generation", () => {
  for (const path of requiredReports) assert.match(entry, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(entry, /ROI_GOVERNOR_INPUT_REPORT_INVALID/);
  assert.match(entry, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/);
  assert.match(entry, /parsed === null \|\| typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  const validation = entry.indexOf("for (const path of REQUIRED_REPORTS)");
  const rawRun = entry.indexOf("report-roi-governor-raw.ts");
  assert.ok(validation >= 0 && rawRun > validation);
  assert.equal(pkg.scripts?.["report:roi-governor"], "tsx scripts/report-roi-governor.ts");
});

test("raw ROI governor retains optional evidence fallbacks only behind the decision-critical input gate", () => {
  assert.match(raw, /reports\/wind24-exh1-switch-deep-dive\.json/);
  assert.match(raw, /reports\/paper-forward-candidates\.json/);
  assert.match(raw, /const baselineN\s*=\s*json\?\.baseline\.n\s*\?\?\s*1522/);
  assert.match(raw, /function determinePhase/);
});
