import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runN2MetricsDefinitionExecutor } from "./n2MetricsDefinitionExecutor";
import type { ExecutorContext } from "./taskExecutors";

function context(root: string, taskStatuses: Record<string, string> = {
  "TASK-N2-022": "PASS",
}): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-metrics-definition-test",
    requestId: "REQ-metrics-definition-test",
    taskId: "TASK-N2-030",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-metrics-definition-executor-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("metrics executor freezes definitions without reading private or settlement data", () => {
  withRoot((root) => {
    const result = runN2MetricsDefinitionExecutor(context(root));
    assert.equal(result.result, "PASS");
    assert.deepEqual(result.outputs, ["reports/n2/n2-metrics-definition.json"]);
    const reportPath = join(root, "reports/n2/n2-metrics-definition.json");
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    assert.equal(report.status, "FROZEN");
    const compatibility = report.compatibility as Record<string, unknown>;
    assert.equal(compatibility.commonCohortRequiredBaselineCount, 3);
    assert.equal(compatibility.commonCohortRequiredRows, 2400);
    assert.equal(compatibility.contractDriftDetected, false);
    const dataAccess = report.dataAccess as Record<string, unknown>;
    assert.deepEqual(dataAccess, {
      privateMarketReadCount: 0,
      settlementReadCount: 0,
      databaseReadCount: 0,
      databaseWriteCount: 0,
      networkRequestCount: 0,
    });
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyExecuted, false);
    const persisted = JSON.stringify(report);
    assert.doesNotMatch(persisted, /2026-\d{2}-\d{2}:\d{2}:R\d+/u);
    assert.doesNotMatch(persisted, /"winningSelection"|"marketOddsBySelection"|"probabilityByBaseline"/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("metrics executor blocks before writing if N2-022 has not passed", () => {
  withRoot((root) => {
    const result = runN2MetricsDefinitionExecutor(context(root, {
      "TASK-N2-022": "BLOCKED",
    }));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-022")));
    assert.deepEqual(result.outputs, []);
    assert.equal(existsSync(join(root, "reports/n2/n2-metrics-definition.json")), false);
  });
});
