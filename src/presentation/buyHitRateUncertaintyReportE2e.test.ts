import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { buildBuyLearningSummary, unavailableBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("BUY hit-rate uncertainty report derives only aggregate Wilson intervals from the final summary", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const summaryPath = `data/tmp/buy-hit-rate-summary-${suffix}.json`;
  const outputPath = `data/tmp/buy-hit-rate-uncertainty-${suffix}.json`;
  await mkdir("data/tmp", { recursive: true });

  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-15T12:00:00.000Z",
    totalDecisions: 58,
    settled: 58,
    hits: 2,
    payoutOddsSum: 68.24,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.03,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvMisses: 10,
  });

  try {
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    const { stdout } = await run(summaryPath, outputPath);
    const status = JSON.parse(stdout.trim()) as {
      status: string;
      performance: { pointEstimate: number; lower: number; upper: number; width: number };
      recent: { pointEstimate: number; lower: number; upper: number; width: number };
      productionChangeAllowed: boolean;
    };
    assert.equal(status.status, "AVAILABLE");
    assert.deepEqual(status.performance, { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 58, successes: 2, pointEstimate: 0.0345, lower: 0.0095, upper: 0.1173, width: 0.1078 });
    assert.deepEqual(status.recent, { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 30, successes: 1, pointEstimate: 0.0333, lower: 0.0059, upper: 0.1667, width: 0.1608 });
    assert.equal(status.productionChangeAllowed, false);

    const reportText = await readFile(outputPath, "utf8");
    assert.match(reportText, /Wilson score intervals/u);
    assert.doesNotMatch(reportText, /selection|raceId|decisionId|currentOdds|requiredOdds|recommendedAmount|stake|segmentKey|\/Users\/|\/home\//iu);
    assert.doesNotMatch(reportText, /roiExMax|payoutOdds|payout_yen/iu);
  } finally {
    await rm(summaryPath, { force: true });
    await rm(outputPath, { force: true });
  }
});

test("BUY hit-rate uncertainty stays NOT_AVAILABLE when settled evidence is unavailable", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const summaryPath = `data/tmp/buy-hit-rate-unavailable-${suffix}.json`;
  const outputPath = `data/tmp/buy-hit-rate-unavailable-output-${suffix}.json`;
  await mkdir("data/tmp", { recursive: true });
  try {
    await writeFile(summaryPath, `${JSON.stringify(unavailableBuyLearningSummary("2026-08-15T12:00:00.000Z"), null, 2)}\n`, "utf8");
    const { stdout } = await run(summaryPath, outputPath);
    const status = JSON.parse(stdout.trim()) as { status: string; performance: unknown; recent: unknown };
    assert.equal(status.status, "NOT_AVAILABLE");
    assert.equal(status.performance, null);
    assert.equal(status.recent, null);
  } finally {
    await rm(summaryPath, { force: true });
    await rm(outputPath, { force: true });
  }
});

function run(summaryPath: string, outputPath: string) {
  return execFileAsync("npx", [
    "tsx", "scripts/report-buy-hit-rate-uncertainty.ts",
    "--summary", summaryPath,
    "--output", outputPath,
  ], { maxBuffer: 1024 * 1024 });
}
