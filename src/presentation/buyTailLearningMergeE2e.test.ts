import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { buildBuyLearningSummary, validateBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("tail learning merge is a no-op at 58 support and promotes only after two complete windows", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const summaryPath = `data/tmp/tail-learning-merge-${suffix}.json`;
  const tailPath = `data/tmp/tail-learning-signal-${suffix}.json`;
  const privateDir = `data/private/tail-learning-merge-${suffix}`;
  await mkdir("data/tmp", { recursive: true });

  const base58 = summary(58);
  try {
    await writeFile(summaryPath, `${JSON.stringify(base58, null, 2)}\n`, "utf8");
    await writeFile(tailPath, `${JSON.stringify(signal("INSUFFICIENT_SUPPORT", 28), null, 2)}\n`, "utf8");
    const first = await run(summaryPath, tailPath, privateDir);
    const firstStatus = JSON.parse(first.stdout.trim()) as { tailLearningAdded: boolean; privateLearningRetained: boolean; productionChangeAllowed: boolean };
    assert.equal(firstStatus.tailLearningAdded, false);
    assert.equal(firstStatus.privateLearningRetained, true);
    assert.equal(firstStatus.productionChangeAllowed, false);
    const firstSummary = JSON.parse(await readFile(summaryPath, "utf8")) as typeof base58;
    assert.deepEqual(firstSummary.learnings.map((item) => item.id), base58.learnings.map((item) => item.id));
    assert.equal((await readdir(privateDir)).length, 1);

    // A real workflow would rebuild the summary after two new official settlements before merging the 60-BUY tail signal.
    const base60 = summary(60);
    await writeFile(summaryPath, `${JSON.stringify(base60, null, 2)}\n`, "utf8");
    await writeFile(tailPath, `${JSON.stringify(signal("PERSISTENT_TAIL_DEPENDENCE", 30), null, 2)}\n`, "utf8");
    const second = await run(summaryPath, tailPath, privateDir);
    const secondStatus = JSON.parse(second.stdout.trim()) as { tailLearningAdded: boolean; privateLearningRetained: boolean };
    assert.equal(secondStatus.tailLearningAdded, true);
    assert.equal(secondStatus.privateLearningRetained, true);
    const secondSummary = JSON.parse(await readFile(summaryPath, "utf8")) as typeof base60;
    assert.deepEqual(validateBuyLearningSummary(secondSummary), []);
    assert.ok(secondSummary.learnings.some((item) => item.id === "TAIL_DEPENDENCE_PERSISTS"));
    assert.ok(secondSummary.researchCandidates.some((item) => item.id === "RESEARCH-TAIL-DEPENDENCE" && item.productionChangeAllowed === false));
    assert.equal((await readdir(privateDir)).length, 2);
    const publicText = JSON.stringify(secondSummary);
    assert.doesNotMatch(publicText, /selection|raceId|decisionId|currentOdds|requiredOdds|recommendedAmount|stake|segmentKey|\/Users\/|\/home\//i);
  } finally {
    await rm(summaryPath, { force: true });
    await rm(tailPath, { force: true });
    await rm(privateDir, { recursive: true, force: true });
  }
});

function summary(settled: number) {
  return buildBuyLearningSummary({
    generatedAt: "2026-08-15T12:00:00.000Z",
    totalDecisions: settled,
    settled,
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
}

function run(summaryPath: string, tailPath: string, privateDir: string) {
  return execFileAsync("npx", [
    "tsx", "scripts/merge-buy-tail-learning.ts",
    "--summary", summaryPath,
    "--tail-signal", tailPath,
    "--retain-private-dir", privateDir,
  ], { maxBuffer: 1024 * 1024 });
}

function signal(status: "INSUFFICIENT_SUPPORT" | "PERSISTENT_TAIL_DEPENDENCE", priorSettled: number) {
  const persistent = status === "PERSISTENT_TAIL_DEPENDENCE";
  return {
    schemaVersion: "buy-tail-dependence-public-v1",
    generatedAt: "2026-08-15T12:00:00.000Z",
    status,
    windowSize: 30,
    minimumTailGap: 0.15,
    totalSettled: 30 + priorSettled,
    support: { recentSettled: 30, priorSettled, missingSettledToCompare: Math.max(0, 30 - priorSettled) },
    recent: { settled: 30, hits: 1, roi: 1.3433, roiExMax: 0, tailGap: 1.3433, tailDependent: true },
    prior: { settled: priorSettled, hits: 1, roi: 1, roiExMax: 0, tailGap: 1, tailDependent: persistent },
    productionChangeAllowed: false,
  };
}
