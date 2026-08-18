import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION,
  runN2TrifectaPrivateMarketFeatureRollup,
} from "./n2TrifectaPrivateMarketFeatureRollup.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-rollup-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeValidPlan(root: string): string {
  const races = Array.from({ length: 12 }, (_, index) => ({
    date: "2026-08-07",
    venueCode: "10",
    raceNo: index + 1,
    closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "35" : "55"}`,
  }));
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races,
  });
  const cache = buildN2TrifectaPrivateDailyPlanCache({
    date: "2026-08-07",
    generatedAt: "2026-08-07T00:45:00.000Z",
    plans: [plan],
    source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
      primaryDbBytes: 123_456,
      primaryDbModifiedMs: 1_786_000_000_000,
      primaryDbWalBytes: 0,
    }),
  });
  writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });
  return plan.manifestDigest;
}

test("feature rollup rejects normalized or ambiguous now values before day selection", () => {
  withRoot((root) => {
    for (const now of [
      "2026-08-07T24:00:00.000Z",
      "2026-02-30T01:00:00.000Z",
      "2026-08-07T01:00:00",
    ]) {
      assert.throws(
        () => runN2TrifectaPrivateMarketFeatureRollup({ dataRoot: root, now }),
        /FEATURE_ROLLUP_NOW_INVALID/u,
        now,
      );
    }
  });
});

test("feature rollup canonicalizes valid explicit-offset now values", () => {
  withRoot((root) => {
    const report = runN2TrifectaPrivateMarketFeatureRollup({
      dataRoot: root,
      now: "2026-08-07T10:00:00+09:00",
    });
    assert.equal(report.status, "NO_CHANGE");
    assert.equal(report.checkedAt, "2026-08-07T01:00:00.000Z");
    assert.equal(report.date, "2026-08-07");
  });
});

test("missing current-day plan is a quiet NO_CHANGE with no IO or production authority", () => {
  withRoot((root) => {
    const report = runN2TrifectaPrivateMarketFeatureRollup({
      dataRoot: root,
      now: "2026-08-07T01:00:00.000Z",
    });
    assert.equal(report.reportVersion, N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION);
    assert.equal(report.status, "NO_CHANGE");
    assert.deepEqual(report.blockers, ["PRIVATE_DAILY_PLAN_NOT_AVAILABLE"]);
    assert.equal(report.venueCode, null);
    assert.equal(report.indexWritten, false);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
    assert.equal(report.productionApplyExecuted, false);
  });
});

test("valid current-day plan with no accepted captures creates a private NO_DATA day index", () => {
  withRoot((root) => {
    const planDigest = writeValidPlan(root);
    const report = runN2TrifectaPrivateMarketFeatureRollup({
      dataRoot: root,
      now: "2026-08-07T01:00:00.000Z",
    });
    assert.equal(report.status, "NO_DATA");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.venueCode, "10");
    assert.equal(report.sourcePlanDigest, planDigest);
    assert.equal(report.raceCount, 12);
    assert.equal(report.passCount, 0);
    assert.equal(report.partialCount, 0);
    assert.equal(report.noDataCount, 12);
    assert.equal(report.blockedCount, 0);
    assert.equal(report.acceptedMarkerCount, 0);
    assert.equal(report.loadedSnapshotCount, 0);
    assert.equal(report.transitionCount, 0);
    assert.equal(report.artifactChangedCount, 0);
    assert.equal(report.races.length, 12);
    assert.ok(report.races.every((race) => race.status === "NO_DATA"));
    assert.equal(report.indexWritten, true);
    assert.equal(report.indexChanged, true);
    assert.ok(report.indexRelativePath);
    assert.ok(report.indexDigest);
    const indexPath = join(root, report.indexRelativePath!);
    assert.equal(statSync(indexPath).mode & 0o777, 0o600);
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>;
    assert.equal(index.status, "NO_DATA");
    assert.equal(index.noDataCount, 12);
    assert.equal(report.rawCaptureEvidenceMayBeReadPrivately, true);
    assert.equal(report.rawOddsValuesPrinted, false);
    assert.equal(report.rawOddsValuesPublished, false);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
  });
});

test("malformed existing current-day plan fails closed before feature processing", () => {
  withRoot((root) => {
    const path = join(root, "data/private/trifecta-capture/plans/2026-08-07.json");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, "{not-json\n", { encoding: "utf8", mode: 0o600 });
    const report = runN2TrifectaPrivateMarketFeatureRollup({
      dataRoot: root,
      now: "2026-08-07T01:00:00.000Z",
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("PRIVATE_DAILY_PLAN_INVALID"));
    assert.equal(report.races.length, 0);
    assert.equal(report.indexWritten, false);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
  });
});
