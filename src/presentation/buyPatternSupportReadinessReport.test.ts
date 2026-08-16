import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY contrast readiness reports observed complement shortfall without segment identity", async () => {
  const path = `data/tmp/buy-contrast-readiness-${process.pid}-${Date.now()}.json`;
  await mkdir("data/tmp", { recursive: true });
  const source = {
    schemaVersion: "buy-outcome-pattern-public-v1", generatedAt: "2026-08-15T12:00:00.000Z", status: "NO_SIGNAL", analyzedSettled: 61,
    support: {
      status: "NO_SUPPORTED_CONTRAST", baselineSettled: 61, minimumSettledPerSide: 30, minimumTotalSettledForAnyContrast: 60,
      globalAdditionalSettledForAnyContrast: 0, validSegmentCount: 21, segmentSideEligibleCount: 5, universalEligibleSegmentCount: 1,
      closestObservedComplementSettled: 27, minimumObservedComplementShortfall: 3, contrastBlocker: "COMPLEMENT_SUPPORT_SHORTFALL",
      supportedContrastCount: 0, supportedDimensionCount: 0,
    },
    noSignalReason: "NO_SUPPORTED_CONTRAST", signals: [], productionChangeAllowed: false,
  };
  try {
    await writeFile(path, `${JSON.stringify(source)}\n`, "utf8");
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/report-buy-pattern-support-readiness.ts", "--patterns", path], { maxBuffer: 1024 * 1024 });
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.deepEqual(report, {
      schemaVersion: "buy-pattern-support-readiness-v1", status: "NO_SUPPORTED_CONTRAST", analyzedSettled: 61, minimumSettledPerSide: 30,
      segmentSideEligibleCount: 5, universalEligibleSegmentCount: 1, closestObservedComplementSettled: 27, minimumObservedComplementShortfall: 3,
      contrastBlocker: "COMPLEMENT_SUPPORT_SHORTFALL", supportedContrastCount: 0, supportedDimensionCount: 0,
      noSignalReason: "NO_SUPPORTED_CONTRAST", productionChangeAllowed: false,
    });
    assert.doesNotMatch(JSON.stringify(report), /segmentKey|selection|currentOdds|requiredOdds|stake|raceId|decisionId|PRIVATE/i);
  } finally { await rm(path, { force: true }); }
});

test("BUY contrast readiness identifies universal segment coverage without exposing which segment", async () => {
  const path = `data/tmp/buy-contrast-universal-${process.pid}-${Date.now()}.json`;
  await mkdir("data/tmp", { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify({
      schemaVersion: "buy-outcome-pattern-public-v1", analyzedSettled: 61,
      support: { status: "NO_SUPPORTED_CONTRAST", minimumSettledPerSide: 30, segmentSideEligibleCount: 5, universalEligibleSegmentCount: 5, closestObservedComplementSettled: 0, minimumObservedComplementShortfall: 30, contrastBlocker: "UNIVERSAL_SEGMENT_COVERAGE", supportedContrastCount: 0, supportedDimensionCount: 0 },
      noSignalReason: "NO_SUPPORTED_CONTRAST", signals: [], productionChangeAllowed: false,
    })}\n`, "utf8");
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/report-buy-pattern-support-readiness.ts", "--patterns", path]);
    const report = JSON.parse(stdout.trim()) as any;
    assert.equal(report.contrastBlocker, "UNIVERSAL_SEGMENT_COVERAGE");
    assert.equal(report.universalEligibleSegmentCount, 5);
    assert.equal(report.closestObservedComplementSettled, 0);
    assert.doesNotMatch(JSON.stringify(report), /segmentKey|PRIVATE/i);
  } finally { await rm(path, { force: true }); }
});

test("BUY contrast readiness fails closed when support math is inconsistent", async () => {
  const path = `data/tmp/buy-contrast-readiness-invalid-${process.pid}-${Date.now()}.json`;
  await mkdir("data/tmp", { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify({
      schemaVersion: "buy-outcome-pattern-public-v1", analyzedSettled: 61,
      support: { status: "NO_SUPPORTED_CONTRAST", minimumSettledPerSide: 30, segmentSideEligibleCount: 5, universalEligibleSegmentCount: 0, closestObservedComplementSettled: 27, minimumObservedComplementShortfall: 1, contrastBlocker: "COMPLEMENT_SUPPORT_SHORTFALL", supportedContrastCount: 0, supportedDimensionCount: 0 },
      noSignalReason: "NO_SUPPORTED_CONTRAST", signals: [], productionChangeAllowed: false,
    })}\n`, "utf8");
    await assert.rejects(execFileAsync("npx", ["tsx", "scripts/report-buy-pattern-support-readiness.ts", "--patterns", path]), (error: unknown) => String((error as { stderr?: string }).stderr ?? error).includes("complement shortfall mismatch"));
  } finally { await rm(path, { force: true }); }
});
