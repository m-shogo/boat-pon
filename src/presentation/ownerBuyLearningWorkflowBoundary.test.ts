import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/owner-buy-learning-refresh.yml"),
  "utf8",
);
const roiReport = readFileSync(
  resolve(process.cwd(), "scripts/report-buy-roi-uncertainty.ts"),
  "utf8",
);

test("owner BUY learning refresh only follows main workflow completions", () => {
  assert.match(workflow, /workflow_run:[\s\S]*branches:\s*\[main\]/u);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.head_branch == 'main'[\s\S]*github\.event\.workflow_run\.conclusion == 'success'/u,
  );
});

test("owner BUY learning refresh serializes instead of cancelling in-flight private learning", () => {
  assert.match(workflow, /group:\s*owner-buy-learning-refresh/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/u);
});

test("automatic outcome learning remains scoped to Current BUY paper-live", () => {
  const runKindMatches = workflow.match(/--run-kind paper-live/gu) ?? [];
  assert.equal(runKindMatches.length, 4);
  for (const script of [
    "analyze-buy-outcome-patterns.ts",
    "analyze-buy-tail-dependence.ts",
    "report-buy-learning-summary.ts",
    "report-buy-roi-uncertainty.ts",
  ]) {
    const start = workflow.indexOf(script);
    assert.ok(start >= 0, `${script} must remain in Owner BUY refresh`);
    assert.match(workflow.slice(start, start + 500), /--run-kind paper-live/u);
  }
  assert.doesNotMatch(workflow, /\bschedule:/u);
});

test("owner BUY learning reads the canonical private local DB instead of checkout-local data", () => {
  assert.match(
    workflow,
    /BOAT_PON_DB_PATH:\s*\/Users\/m-shogo\/Developer\/personal\/boat-pon\/data\/boat\.sqlite/u,
  );
  assert.match(workflow, /name:\s*Verify private BUY source DB[\s\S]*test -f "\$BOAT_PON_DB_PATH"/u);
  assert.doesNotMatch(workflow, /cp\s+[^\n]*boat\.sqlite/u);
});

test("persistent Mac Owner refresh avoids slow remote npm cache restoration", () => {
  const start = workflow.indexOf("- name: Setup Node");
  const end = workflow.indexOf("- name: Install", start);
  assert.ok(start >= 0 && end > start);
  const setupNodeStep = workflow.slice(start, end);
  assert.match(setupNodeStep, /actions\/setup-node@v4/u);
  assert.match(setupNodeStep, /node-version-file:\s*\.nvmrc/u);
  assert.doesNotMatch(setupNodeStep, /\bcache:/u);
  assert.match(workflow, /- name:\s*Install[\s\S]*run:\s*npm ci/u);
});

test("owner BUY refresh researches max-hit dependence only across independent supported windows", () => {
  assert.match(workflow, /name:\s*Analyze BUY max-hit dependence across independent windows/u);
  assert.match(workflow, /analyze-buy-tail-dependence\.ts[\s\S]*--window-size 30[\s\S]*--min-tail-gap 0\.15/u);
  assert.match(workflow, /--retain-private-dir data\/private\/outcome-tail-ledger/u);
  assert.match(workflow, /--output-public data\/tmp\/owner-buy-tail-public\.json/u);
});

test("owner BUY refresh retains only the final tail-enriched learning summary", () => {
  const summaryStart = workflow.indexOf("- name: Build read-only BUY outcome learning summary");
  const mergeStart = workflow.indexOf("- name: Merge supported tail stability and retain final BUY learning");
  const uncertaintyStart = workflow.indexOf("- name: Report BUY hit-rate uncertainty");
  const diagnosticsStart = workflow.indexOf("- name: Report public-safe BUY learning diagnostics");
  assert.ok(summaryStart >= 0 && mergeStart > summaryStart && uncertaintyStart > mergeStart && diagnosticsStart > uncertaintyStart);
  const summaryStep = workflow.slice(summaryStart, mergeStart);
  const mergeStep = workflow.slice(mergeStart, uncertaintyStart);
  assert.doesNotMatch(summaryStep, /--retain-private-dir/u);
  assert.match(mergeStep, /merge-buy-tail-learning\.ts/u);
  assert.match(mergeStep, /--tail-signal data\/tmp\/owner-buy-tail-public\.json/u);
  assert.match(mergeStep, /--retain-private-dir data\/private\/outcome-learning-ledger/u);
});

test("owner BUY refresh derives Wilson uncertainty from the final learning summary without another DB read", () => {
  const start = workflow.indexOf("- name: Report BUY hit-rate uncertainty");
  const end = workflow.indexOf("- name: Report BUY ROI uncertainty", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /report-buy-hit-rate-uncertainty\.ts/u);
  assert.match(step, /--summary data\/tmp\/owner-buy-learning-latest\.json/u);
  assert.match(step, /--output data\/tmp\/owner-buy-hit-rate-uncertainty\.json/u);
  assert.doesNotMatch(step, /BOAT_PON_DB_PATH|boat\.sqlite|--run-kind/u);
});

test("owner BUY ROI uncertainty reuses the official paper-live settlement source read-only", () => {
  const start = workflow.indexOf("- name: Report BUY ROI uncertainty");
  const end = workflow.indexOf("- name: Report public-safe BUY learning diagnostics", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /report-buy-roi-uncertainty\.ts/u);
  assert.match(step, /--run-kind paper-live/u);
  assert.match(step, /--recent 30/u);
  assert.match(step, /--minimum-trials 30/u);
  assert.match(step, /--iterations 5000/u);
  assert.match(step, /--output data\/tmp\/owner-buy-roi-uncertainty\.json/u);

  assert.match(roiReport, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(roiReport, /PRAGMA query_only = ON/u);
  assert.match(roiReport, /buildBuyOutcomeSettlementSource\(\{ runKind: args\.runKind \}\)/u);
  assert.match(roiReport, /parsed\.runKind !== "paper-live"/u);
  assert.match(roiReport, /productionChangeAllowed:\s*false/u);
  assert.doesNotMatch(roiReport, /from "\.\.\/server\/db"|UPDATE\s+decision_history|INSERT\s+INTO\s+decision_history|DELETE\s+FROM\s+decision_history/u);
});

test("owner BUY diagnostics expose only aggregate public-safe learning state", () => {
  const start = workflow.indexOf("- name: Report public-safe BUY learning diagnostics");
  const end = workflow.indexOf("- name: Build validated Owner BUY evidence diagnostics", start);
  assert.ok(start >= 0 && end > start);
  const diagnosticsStep = workflow.slice(start, end);

  assert.match(diagnosticsStep, /schemaVersion:\s*'owner-buy-learning-diagnostics-v1'/u);
  assert.match(diagnosticsStep, /hitRateUncertainty:/u);
  assert.match(diagnosticsStep, /owner-buy-hit-rate-uncertainty\.json/u);
  assert.match(diagnosticsStep, /roiUncertainty:/u);
  assert.match(diagnosticsStep, /owner-buy-roi-uncertainty\.json/u);
  assert.match(diagnosticsStep, /patternSupport:/u);
  assert.match(diagnosticsStep, /noSignalReason:/u);
  assert.match(diagnosticsStep, /minimumSettledPerSide:/u);
  assert.match(diagnosticsStep, /globalAdditionalSettledForAnyContrast:/u);
  assert.match(diagnosticsStep, /supportedContrastCount:/u);
  assert.match(diagnosticsStep, /supportedDimensionCount:/u);
  assert.match(diagnosticsStep, /learningIds:/u);
  assert.match(diagnosticsStep, /failurePatternIds:/u);
  assert.match(diagnosticsStep, /researchCandidateIds:/u);
  assert.match(diagnosticsStep, /patternSignals:/u);
  assert.match(diagnosticsStep, /tailStability:/u);
  assert.match(diagnosticsStep, /missingSettledToCompare:/u);
  assert.match(diagnosticsStep, /recentTailGap:/u);
  assert.match(diagnosticsStep, /priorTailGap:/u);
  assert.match(diagnosticsStep, /productionChangeAllowed:\s*false/u);
  assert.match(diagnosticsStep, /private or operational BUY field reached public-safe diagnostics/u);
  assert.doesNotMatch(diagnosticsStep, /item\.segmentKey|patterns\.support\?\.segmentKey|item\.selection|item\.currentOdds|item\.raceId|item\.decisionId/u);
});

test("owner BUY evidence is schema-validated before entering the public snapshot", () => {
  const buildStart = workflow.indexOf("- name: Build validated Owner BUY evidence diagnostics");
  const boundaryStart = workflow.indexOf("- name: Verify public source boundary", buildStart);
  assert.ok(buildStart >= 0 && boundaryStart > buildStart);
  const buildStep = workflow.slice(buildStart, boundaryStart);
  assert.match(buildStep, /build-owner-buy-evidence-diagnostics\.ts/u);
  assert.match(buildStep, /--buy-learning data\/tmp\/owner-buy-learning-latest\.json/u);
  assert.match(buildStep, /--patterns data\/tmp\/owner-buy-patterns-public\.json/u);
  assert.match(buildStep, /--tail data\/tmp\/owner-buy-tail-public\.json/u);
  assert.match(buildStep, /--uncertainty data\/tmp\/owner-buy-hit-rate-uncertainty\.json/u);
  assert.match(buildStep, /--roi-uncertainty data\/tmp\/owner-buy-roi-uncertainty\.json/u);
  assert.match(buildStep, /--output data\/tmp\/owner-buy-evidence\.json/u);

  const snapshotStart = workflow.indexOf("- name: Build Owner snapshot with BUY learning");
  const snapshotEnd = workflow.indexOf("- name: Assemble deploy-ready directory", snapshotStart);
  const snapshotStep = workflow.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotStep, /--buy-evidence data\/tmp\/owner-buy-evidence\.json/u);
});
