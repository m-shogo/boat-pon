import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2MarketOnlyBaselineRaceSource } from "../research-replay/n2MarketOnlyBaselineDataset";
import type { N2MarketOnlyBaselinePrivateSourceRead } from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import { createN2MarketOnlyBaselineExecutor } from "./n2MarketOnlyBaselineExecutor";
import type { ExecutorContext } from "./taskExecutors";

function selections(): N2MarketOnlyBaselineRaceSource["selections"] {
  const rows: N2MarketOnlyBaselineRaceSource["selections"] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        rows.push({ selection: `${first}-${second}-${third}`, odds: first * 100 + second * 10 + third });
      }
    }
  }
  return rows;
}

function source(index: number): N2MarketOnlyBaselineRaceSource {
  const date = index < 12 ? "2026-08-07" : "2026-08-08";
  const raceNo = index < 12 ? index + 1 : index - 11;
  return {
    canonicalRaceKey: `${date}:05:R${raceNo}`,
    decisionCutoff: `${date}T03:30:00.000Z`,
    capturedAt: `${date}T03:25:30.000Z`,
    availableAt: `${date}T03:25:00.000Z`,
    observationId: `obs-${date}-${raceNo}`,
    rawDocumentId: `raw-${date}-${raceNo}`,
    winningSelection: "1-2-3",
    selections: selections(),
  };
}

function privateRead(overrides: Partial<N2MarketOnlyBaselinePrivateSourceRead> = {}): N2MarketOnlyBaselinePrivateSourceRead {
  return {
    readerVersion: "n2-market-only-baseline-private-source-v1",
    status: "PASS",
    blockers: [],
    readinessStatus: "READY_FOR_N2_020",
    readinessDigest: "a".repeat(64),
    acceptedT5RaceCount: 20,
    settledAcceptedT5RaceCount: 20,
    selectedCohortRaceCount: 20,
    sources: Array.from({ length: 20 }, (_, index) => source(index)),
    privateRawFileReadCount: 20,
    privateEnvelopeReadCount: 20,
    databaseReadCount: 2,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
    ...overrides,
  };
}

function context(root: string, taskStatuses: Record<string, string> = {
  "TASK-N2-005": "PASS",
  "TASK-N2-011": "PASS",
}): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-market-baseline-test",
    requestId: "REQ-market-baseline-test",
    taskId: "TASK-N2-020",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-baseline-executor-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("executor persists aggregate market baseline evidence without raw rows", () => {
  withRoot((root) => {
    let readerCalls = 0;
    const executor = createN2MarketOnlyBaselineExecutor(() => {
      readerCalls += 1;
      return privateRead();
    });
    const result = executor(context(root));
    assert.equal(result.result, "PASS");
    assert.equal(readerCalls, 1);
    assert.deepEqual(result.outputs, ["reports/n2/n2-baseline-market.json"]);
    const reportPath = join(root, "reports/n2/n2-baseline-market.json");
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    assert.equal(report.baselineId, "n2-market-only-t5-v1");
    assert.equal(report.cohortRaceCount, 20);
    assert.equal(report.predictionRowCount, 2400);
    assert.equal(report.positiveCount, 20);
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyExecuted, false);
    const persisted = JSON.stringify(report);
    assert.doesNotMatch(persisted, /"rows"\s*:/u);
    assert.doesNotMatch(persisted, /"sources"\s*:/u);
    assert.doesNotMatch(persisted, /"winningSelection"\s*:/u);
    assert.doesNotMatch(persisted, /"selections"\s*:/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("executor blocks on dependency before touching private evidence", () => {
  withRoot((root) => {
    let readerCalls = 0;
    const executor = createN2MarketOnlyBaselineExecutor(() => {
      readerCalls += 1;
      return privateRead();
    });
    const result = executor(context(root, {
      "TASK-N2-005": "PASS",
      "TASK-N2-011": "BLOCKED",
    }));
    assert.equal(result.result, "BLOCKED");
    assert.equal(readerCalls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-011")));
    assert.deepEqual(result.outputs, []);
  });
});

test("executor keeps N2-020 blocked when private readiness regresses", () => {
  withRoot((root) => {
    const executor = createN2MarketOnlyBaselineExecutor(() => privateRead({
      status: "BLOCKED",
      blockers: ["READINESS_ACCUMULATING"],
      readinessStatus: "ACCUMULATING",
      settledAcceptedT5RaceCount: 19,
      selectedCohortRaceCount: 0,
      sources: [],
      privateRawFileReadCount: 0,
      privateEnvelopeReadCount: 0,
      rawValuesReadPrivately: false,
    }));
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("MARKET_BASELINE_READINESS_ACCUMULATING")));
    assert.deepEqual(result.outputs, []);
  });
});
