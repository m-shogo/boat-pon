import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { buildBuyLearningSummary, validateBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("replication support shortfall becomes an aggregate learning without changing research candidates", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const summaryPath = `data/tmp/replication-readiness-summary-${suffix}.json`;
  const replicationPath = `data/tmp/replication-readiness-source-${suffix}.json`;
  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-15T16:41:23Z",
    totalDecisions: 61,
    settled: 61,
    hits: 2,
    payoutOddsSum: 68.3,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.03,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvMisses: 10,
  });
  const replication = {
    schemaVersion: "buy-pattern-replication-public-v1",
    generatedAt: "2026-08-15T16:41:22Z",
    status: "INSUFFICIENT_WINDOW_SUPPORT",
    totalSettled: 61,
    windowSize: 60,
    requiredSettled: 120,
    missingSettledToCompare: 59,
    discoveryPatternCount: 0,
    confirmationPatternCount: 0,
    replicatedPatternCount: 0,
    signals: [],
    productionChangeAllowed: false,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(replicationPath, `${JSON.stringify(replication, null, 2)}\n`);
  try {
    const beforeCandidates = summary.researchCandidates.map((item) => item.id);
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/merge-buy-pattern-replication-readiness.ts", "--summary", summaryPath, "--replication", replicationPath]);
    const status = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(status.replicationStatus, "INSUFFICIENT_WINDOW_SUPPORT");
    assert.equal(status.totalSettled, 61);
    assert.equal(status.requiredSettled, 120);
    assert.equal(status.missingSettledToCompare, 59);
    assert.equal(status.readinessLearningId, "PATTERN_REPLICATION_PENDING");
    assert.equal(status.productionChangeAllowed, false);

    const enriched = JSON.parse(await readFile(summaryPath, "utf8")) as ReturnType<typeof buildBuyLearningSummary>;
    assert.deepEqual(validateBuyLearningSummary(enriched), []);
    const readiness = enriched.learnings.find((item) => item.id === "PATTERN_REPLICATION_PENDING");
    assert.ok(readiness);
    assert.equal(readiness.severity, "INFO");
    assert.equal(readiness.evidenceCount, 61);
    assert.match(readiness.summary, /現在61\/120件、あと59件/u);
    assert.deepEqual(enriched.researchCandidates.map((item) => item.id), beforeCandidates);
    assert.doesNotMatch(JSON.stringify(enriched), /segmentKey|selection|raceId|decisionId|currentOdds|requiredOdds|recommendedAmount|stake|PRIVATE/u);
  } finally {
    await rm(summaryPath, { force: true });
    await rm(replicationPath, { force: true });
  }
});

test("replication readiness fails closed when the settled cohort differs", async () => {
  const suffix = `${process.pid}-${Date.now()}-mismatch`;
  const summaryPath = `data/tmp/replication-readiness-summary-${suffix}.json`;
  const replicationPath = `data/tmp/replication-readiness-source-${suffix}.json`;
  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-15T16:41:23Z",
    totalDecisions: 61,
    settled: 61,
    hits: 2,
    payoutOddsSum: 68.3,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.03,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvMisses: 10,
  });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(replicationPath, `${JSON.stringify({
    schemaVersion: "buy-pattern-replication-public-v1",
    generatedAt: "2026-08-15T16:41:22Z",
    status: "INSUFFICIENT_WINDOW_SUPPORT",
    totalSettled: 60,
    windowSize: 60,
    requiredSettled: 120,
    missingSettledToCompare: 60,
    discoveryPatternCount: 0,
    confirmationPatternCount: 0,
    replicatedPatternCount: 0,
    signals: [],
    productionChangeAllowed: false,
  }, null, 2)}\n`);
  try {
    await assert.rejects(
      execFileAsync("npx", ["tsx", "scripts/merge-buy-pattern-replication-readiness.ts", "--summary", summaryPath, "--replication", replicationPath]),
      /settled count mismatch/u,
    );
  } finally {
    await rm(summaryPath, { force: true });
    await rm(replicationPath, { force: true });
  }
});
