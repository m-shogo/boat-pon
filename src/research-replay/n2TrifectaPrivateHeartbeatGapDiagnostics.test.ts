import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
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
import { buildN2TrifectaPrivateHeartbeatRecord } from "./n2TrifectaPrivateHeartbeat.js";
import { buildN2TrifectaPrivateHeartbeatGapDiagnostics } from
  "./n2TrifectaPrivateHeartbeatGapDiagnostics.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-heartbeat-gap-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeHeartbeatHistory(root: string, timestamps: string[], mutateLast?: (value: any) => void): void {
  const path = join(root, "data/private/trifecta-capture/heartbeats/2026-08-07.jsonl");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const records = timestamps.map((recordedAt) => buildN2TrifectaPrivateHeartbeatRecord({
    recordedAt,
    status: "NO_CHANGE",
    blockers: [],
    authoritySha: "0123456789abcdef0123456789abcdef01234567",
    runtimeAuthorityStatus: "PASS",
  }));
  if (mutateLast && records.length > 0) mutateLast(records[records.length - 1]);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function writeDailyPlan(root: string): void {
  const races = Array.from({ length: 12 }, (_, index) => ({
    date: "2026-08-07",
    venueCode: "10",
    raceNo: index + 1,
    closeAt: index === 0
      ? "10:32"
      : `${String(11 + Math.floor((index - 1) / 2)).padStart(2, "0")}:${index % 2 === 1 ? "05" : "35"}`,
  }));
  const plan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races,
  });
  const cache = buildN2TrifectaPrivateDailyPlanCache({
    date: "2026-08-07",
    generatedAt: "2026-08-07T00:50:00.000Z",
    plans: [plan],
    source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
      primaryDbBytes: 123_456,
      primaryDbModifiedMs: 1_786_000_000_000,
      primaryDbWalBytes: 0,
    }),
  });
  writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });
}

test("detects a significant heartbeat gap and correlates overlapping checkpoint windows", () => {
  withRoot((root) => {
    writeDailyPlan(root);
    writeHeartbeatHistory(root, [
      "2026-08-07T00:59:30.000Z",
      "2026-08-07T01:00:00.000Z",
      "2026-08-07T01:00:30.000Z",
      "2026-08-07T01:05:00.000Z",
      "2026-08-07T01:05:30.000Z",
    ]);

    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T01:06:00.000Z",
    });

    assert.equal(report.status, "DEGRADED");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.historyPresent, true);
    assert.equal(report.historyRecordCount, 5);
    assert.equal(report.latestAgeSeconds, 30);
    assert.equal(report.significantGapCount, 1);
    assert.equal(report.recentSignificantGapCount, 1);
    assert.equal(report.largestGapSeconds, 270);
    assert.equal(report.currentGapOverThreshold, false);
    assert.equal(report.planStatus, "PASS");
    assert.ok(report.affectedCheckpointCount >= 1);
    const affected = report.gaps[0]?.affectedCheckpoints.find(
      (checkpoint) => checkpoint.raceIdentity === "20260807-10-01"
        && checkpoint.checkpointLabel === "T-30",
    );
    assert.ok(affected);
    assert.equal(affected.targetCaptureAt, "2026-08-07T01:02:00.000Z");
    assert.equal(affected.overlapSeconds, 120);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.rawOddsValuesRead, false);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
  });
});

test("healthy 30-second heartbeat history passes without a current gap", () => {
  withRoot((root) => {
    writeDailyPlan(root);
    writeHeartbeatHistory(root, [
      "2026-08-07T01:04:00.000Z",
      "2026-08-07T01:04:30.000Z",
      "2026-08-07T01:05:00.000Z",
      "2026-08-07T01:05:30.000Z",
    ]);
    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T01:06:00.000Z",
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.significantGapCount, 0);
    assert.equal(report.currentGapOverThreshold, false);
    assert.equal(report.latestAgeSeconds, 30);
  });
});

test("unsafe or widened heartbeat metadata fails closed", () => {
  withRoot((root) => {
    writeHeartbeatHistory(
      root,
      ["2026-08-07T01:05:30.000Z"],
      (record) => { record.rawOddsValuesRecorded = true; },
    );
    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T01:06:00.000Z",
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("HEARTBEAT_RAW_ODDS_BOUNDARY_INVALID"));
  });
});
