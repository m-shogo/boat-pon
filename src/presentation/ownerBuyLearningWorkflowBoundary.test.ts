import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/owner-buy-learning-refresh.yml"), "utf8");
const roiReport = readFileSync(resolve(process.cwd(), "scripts/report-buy-roi-uncertainty.ts"), "utf8");
const calibrationReport = readFileSync(resolve(process.cwd(), "scripts/report-buy-probability-calibration.ts"), "utf8");
const replicationReport = readFileSync(resolve(process.cwd(), "scripts/analyze-buy-pattern-replication.ts"), "utf8");

test("owner BUY learning refresh only follows successful main workflow completions and serializes", () => {
  assert.match(workflow, /workflow_run:[\s\S]*branches:\s*\[main\]/u);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'[\s\S]*github\.event\.workflow_run\.conclusion == 'success'/u);
  assert.match(workflow, /group:\s*owner-buy-learning-refresh/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true|\bschedule:/u);
});

test("automatic DB-reading outcome analysis remains scoped to Current BUY paper-live", () => {
  const runKindMatches = workflow.match(/--run-kind paper-live/gu) ?? [];
  assert.equal(runKindMatches.length, 6);
  for (const script of [
    "analyze-buy-outcome-patterns.ts",
    "analyze-buy-pattern-replication.ts",
    "analyze-buy-tail-dependence.ts",
    "report-buy-learning-summary.ts",
    "report-buy-roi-uncertainty.ts",
    "report-buy-probability-calibration.ts",
  ]) {
    const start = workflow.indexOf(script);
    assert.ok(start >= 0, `${script} must remain in Owner BUY refresh`);
    assert.match(workflow.slice(start, start + 700), /--run-kind paper-live/u);
  }
});

test("owner BUY learning reads canonical private local DB without copying it", () => {
  assert.match(workflow, /BOAT_PON_DB_PATH:\s*\/Users\/m-shogo\/Developer\/personal\/boat-pon\/data\/boat\.sqlite/u);
  assert.match(workflow, /name:\s*Verify private BUY source DB[\s\S]*test -f "\$BOAT_PON_DB_PATH"/u);
  assert.doesNotMatch(workflow, /cp\s+[^\n]*boat\.sqlite/u);
});

test("persistent Mac Owner refresh keeps Node selection but avoids remote npm cache restoration", () => {
  const start = workflow.indexOf("- name: Setup Node");
  const end = workflow.indexOf("- name: Install", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /actions\/setup-node@v4/u);
  assert.match(step, /node-version-file:\s*\.nvmrc/u);
  assert.doesNotMatch(step, /\bcache:/u);
  assert.match(workflow, /- name:\s*Install[\s\S]*run:\s*npm ci/u);
});

test("pattern learning requires two independent windows and exact replication projection", () => {
  const start = workflow.indexOf("- name: Confirm BUY patterns across independent windows");
  const projectStart = workflow.indexOf("- name: Project only replicated BUY patterns into learning input", start);
  const tailStart = workflow.indexOf("- name: Analyze BUY max-hit dependence across independent windows", projectStart);
  assert.ok(start >= 0 && projectStart > start && tailStart > projectStart);
  const confirmation = workflow.slice(start, projectStart);
  const projection = workflow.slice(projectStart, tailStart);
  assert.match(confirmation, /analyze-buy-pattern-replication\.ts/u);
  assert.match(confirmation, /--run-kind paper-live/u);
  assert.match(confirmation, /--window-size 60/u);
  assert.match(confirmation, /--min-settled 30/u);
  assert.match(confirmation, /--min-roi-delta 0\.15/u);
  assert.match(confirmation, /--retain-private-dir data\/private\/outcome-pattern-replication-ledger/u);
  assert.match(projection, /project-replicated-buy-pattern-signals\.ts/u);
  assert.match(projection, /owner-buy-pattern-replication-public\.json/u);
  assert.match(projection, /owner-buy-patterns-replicated-input\.json/u);

  assert.match(replicationReport, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(replicationReport, /PRAGMA query_only = ON/u);
  assert.match(replicationReport, /buildBuyOutcomeSettlementSource\(\{ runKind: args\.runKind \}\)/u);
  assert.match(replicationReport, /parsed\.runKind !== "paper-live"/u);
  assert.match(replicationReport, /requiredSettled = args\.windowSize \* 2/u);
  assert.match(replicationReport, /temporal_row > \? AND temporal_row <= \?/u);
  assert.doesNotMatch(replicationReport, /from "\.\.\/server\/db"|UPDATE\s+decision_history|INSERT\s+INTO\s+decision_history|DELETE\s+FROM\s+decision_history/u);
});

test("final BUY summary consumes only replicated pattern signals and retains only final enriched learning", () => {
  const summaryStart = workflow.indexOf("- name: Build read-only BUY outcome learning summary");
  const readinessStart = workflow.indexOf("- name: Merge BUY pattern replication readiness into learning", summaryStart);
  const mergeStart = workflow.indexOf("- name: Merge supported tail stability and retain final BUY learning", readinessStart);
  const uncertaintyStart = workflow.indexOf("- name: Report BUY hit-rate uncertainty", mergeStart);
  assert.ok(summaryStart >= 0 && readinessStart > summaryStart && mergeStart > readinessStart && uncertaintyStart > mergeStart);
  const summary = workflow.slice(summaryStart, readinessStart);
  const merge = workflow.slice(mergeStart, uncertaintyStart);
  assert.match(summary, /--pattern-signals data\/tmp\/owner-buy-patterns-replicated-input\.json/u);
  assert.doesNotMatch(summary, /--pattern-signals data\/tmp\/owner-buy-patterns-public\.json|--retain-private-dir/u);
  assert.match(merge, /merge-buy-tail-learning\.ts/u);
  assert.match(merge, /--tail-signal data\/tmp\/owner-buy-tail-public\.json/u);
  assert.match(merge, /--retain-private-dir data\/private\/outcome-learning-ledger/u);
});

test("tail dependence remains independent-window research only", () => {
  assert.match(workflow, /name:\s*Analyze BUY max-hit dependence across independent windows/u);
  assert.match(workflow, /analyze-buy-tail-dependence\.ts[\s\S]*--window-size 30[\s\S]*--min-tail-gap 0\.15/u);
  assert.match(workflow, /--retain-private-dir data\/private\/outcome-tail-ledger/u);
});

test("Wilson uncertainty derives from final summary without another DB read", () => {
  const start = workflow.indexOf("- name: Report BUY hit-rate uncertainty");
  const end = workflow.indexOf("- name: Report BUY ROI uncertainty", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /report-buy-hit-rate-uncertainty\.ts/u);
  assert.match(step, /--summary data\/tmp\/owner-buy-learning-latest\.json/u);
  assert.doesNotMatch(step, /BOAT_PON_DB_PATH|boat\.sqlite|--run-kind/u);
});

test("ROI uncertainty reuses official paper-live settlement source read-only", () => {
  const start = workflow.indexOf("- name: Report BUY ROI uncertainty");
  const end = workflow.indexOf("- name: Report BUY probability calibration", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /report-buy-roi-uncertainty\.ts/u);
  assert.match(step, /--run-kind paper-live/u);
  assert.match(step, /--recent 30/u);
  assert.match(step, /--minimum-trials 30/u);
  assert.match(step, /--iterations 5000/u);
  assert.match(roiReport, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(roiReport, /PRAGMA query_only = ON/u);
  assert.match(roiReport, /buildBuyOutcomeSettlementSource\(\{ runKind: args\.runKind \}\)/u);
  assert.match(roiReport, /parsed\.runKind !== "paper-live"/u);
  assert.doesNotMatch(roiReport, /from "\.\.\/server\/db"|UPDATE\s+decision_history|INSERT\s+INTO\s+decision_history|DELETE\s+FROM\s+decision_history/u);
});

test("probability calibration uses official outcomes read-only with explicit support and high-EV cohort", () => {
  const start = workflow.indexOf("- name: Report BUY probability calibration");
  const end = workflow.indexOf("- name: Report public-safe BUY learning diagnostics", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /report-buy-probability-calibration\.ts/u);
  assert.match(step, /--run-kind paper-live/u);
  assert.match(step, /--recent 30/u);
  assert.match(step, /--minimum-trials 30/u);
  assert.match(step, /--high-ev-threshold 1\.2/u);
  assert.match(step, /owner-buy-probability-calibration\.json/u);

  assert.match(calibrationReport, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(calibrationReport, /PRAGMA query_only = ON/u);
  assert.match(calibrationReport, /buildBuyOutcomeSettlementSource\(\{ runKind: args\.runKind \}\)/u);
  assert.match(calibrationReport, /estimated_hit_rate outside \[0,1\]/u);
  assert.match(calibrationReport, /args\.highEvThreshold/u);
  assert.match(calibrationReport, /productionChangeAllowed:\s*false/u);
  assert.doesNotMatch(calibrationReport, /from "\.\.\/server\/db"|UPDATE\s+decision_history|INSERT\s+INTO\s+decision_history|DELETE\s+FROM\s+decision_history/u);
});

test("public diagnostics expose aggregate uncertainty/calibration only", () => {
  const start = workflow.indexOf("- name: Report public-safe BUY learning diagnostics");
  const end = workflow.indexOf("- name: Build validated Owner BUY evidence diagnostics", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  for (const marker of [
    "hitRateUncertainty:", "roiUncertainty:", "probabilityCalibration:", "patternSupport:", "patternReplication:",
    "learningIds:", "failurePatternIds:", "researchCandidateIds:", "patternSignals:", "tailStability:",
  ]) assert.match(step, new RegExp(marker));
  assert.match(step, /owner-buy-probability-calibration\.json/u);
  assert.match(step, /productionChangeAllowed:\s*false/u);
  assert.match(step, /private or operational BUY field reached public-safe diagnostics/u);
  assert.doesNotMatch(step, /item\.segmentKey|item\.selection|item\.currentOdds|item\.raceId|item\.decisionId/u);
});

test("Owner BUY evidence remains schema-validated before public snapshot", () => {
  const buildStart = workflow.indexOf("- name: Build validated Owner BUY evidence diagnostics");
  const boundaryStart = workflow.indexOf("- name: Verify public source boundary", buildStart);
  assert.ok(buildStart >= 0 && boundaryStart > buildStart);
  const build = workflow.slice(buildStart, boundaryStart);
  assert.match(build, /build-owner-buy-evidence-diagnostics\.ts/u);
  assert.match(build, /--buy-learning data\/tmp\/owner-buy-learning-latest\.json/u);
  assert.match(build, /--patterns data\/tmp\/owner-buy-patterns-public\.json/u);
  assert.match(build, /--tail data\/tmp\/owner-buy-tail-public\.json/u);
  assert.match(build, /--uncertainty data\/tmp\/owner-buy-hit-rate-uncertainty\.json/u);
  assert.match(build, /--roi-uncertainty data\/tmp\/owner-buy-roi-uncertainty\.json/u);
  assert.match(build, /--output data\/tmp\/owner-buy-evidence\.json/u);

  const snapshotStart = workflow.indexOf("- name: Build Owner snapshot with BUY learning");
  const snapshotEnd = workflow.indexOf("- name: Assemble deploy-ready directory", snapshotStart);
  assert.match(workflow.slice(snapshotStart, snapshotEnd), /--buy-evidence data\/tmp\/owner-buy-evidence\.json/u);
});
