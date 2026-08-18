import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendN2TrifectaPrivateHeartbeat,
  buildN2TrifectaPrivateHeartbeatRecord,
} from "./n2TrifectaPrivateHeartbeat";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex";
import {
  buildN2TrifectaPrivateMarketDailyReadiness,
  writeN2TrifectaPrivateMarketDailyReadiness,
} from "./n2TrifectaPrivateMarketDailyReadiness";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function syntheticReport(input: {
  raceNo: number;
  status: "PASS" | "PARTIAL";
  availableCount: number;
}): N2TrifectaPrivateMarketFeatureLoadReport {
  const availableCheckpoints = checkpoints.slice(0, input.availableCount);
  const missingCheckpoints = checkpoints.slice(input.availableCount);
  const snapshots = availableCheckpoints.map((checkpointLabel, index) => ({
    checkpointLabel,
    syntheticSnapshotIndex: index,
  }));
  const transitions = availableCheckpoints.slice(1).map((checkpointLabel, index) => ({
    fromCheckpointLabel: availableCheckpoints[index],
    toCheckpointLabel: checkpointLabel,
  }));
  const raceIdentity = `20260807-10-${String(input.raceNo).padStart(2, "0")}`;
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: input.status,
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: input.raceNo,
    raceIdentity,
    acceptedMarkerCount: availableCheckpoints.length,
    loadedSnapshotCount: availableCheckpoints.length,
    sequence: {
      featureVersion: "n2-trifecta-market-features-v1",
      status: input.status,
      raceIdentity,
      availableCheckpoints: [...availableCheckpoints],
      missingCheckpoints: [...missingCheckpoints],
      snapshots,
      transitions,
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: input.raceNo.toString(16).padStart(64, "0"),
  };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-daily-readiness-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seedIndex(root: string): string {
  writeN2TrifectaPrivateMarketFeatureArtifact({
    rootDir: root,
    report: syntheticReport({ raceNo: 1, status: "PASS", availableCount: 4 }),
    generatedAt: "2026-08-07T02:00:00.000Z",
  });
  writeN2TrifectaPrivateMarketFeatureArtifact({
    rootDir: root,
    report: syntheticReport({ raceNo: 2, status: "PARTIAL", availableCount: 2 }),
    generatedAt: "2026-08-07T02:01:00.000Z",
  });
  const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: root,
    date: "2026-08-07",
    venueCode: "10",
    generatedAt: "2026-08-07T02:05:00.000Z",
  });
  return writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index }).relativePath;
}

function seedHealthyHeartbeat(root: string): void {
  for (const recordedAt of ["2026-08-07T02:09:00.000Z", "2026-08-07T02:09:30.000Z"]) {
    appendN2TrifectaPrivateHeartbeat({
      dataRoot: root,
      record: buildN2TrifectaPrivateHeartbeatRecord({
        recordedAt,
        status: "NO_CHANGE",
        runtimeAuthorityStatus: "PASS",
        authoritySha: "a".repeat(40),
      }),
    });
  }
}

test("readiness summarizes verified day coverage without outcomes or feature vectors", () => {
  withRoot((root) => {
    seedIndex(root);
    seedHealthyHeartbeat(root);

    const readiness = buildN2TrifectaPrivateMarketDailyReadiness({
      dataRoot: root,
      date: "2026-08-07",
      venueCode: "10",
      checkedAt: "2026-08-07T02:10:00.000Z",
    });

    assert.equal(readiness.status, "DEGRADED");
    assert.deepEqual(readiness.blockers, []);
    assert.equal(readiness.sourceDayIndexStatus, "PARTIAL");
    assert.equal(readiness.completeRaceCount, 1);
    assert.equal(readiness.partialRaceCount, 1);
    assert.equal(readiness.noDataRaceCount, 10);
    assert.equal(readiness.cohortCandidateRaceCount, 1);
    assert.deepEqual(readiness.cohortCandidateRaceIdentities, ["20260807-10-01"]);
    assert.equal(readiness.totalSnapshotCount, 6);
    assert.equal(readiness.totalTransitionCount, 4);
    assert.equal(readiness.checkpointCoverageNumerator, 6);
    assert.equal(readiness.checkpointCoverageDenominator, 48);
    assert.equal(readiness.checkpointCoverageRatio, 0.125);
    assert.equal(readiness.heartbeatStatus, "PASS");
    assert.equal(readiness.heartbeatPlanStatus, "UNAVAILABLE");
    assert.equal(readiness.heartbeatHistoryRecordCount, 2);
    assert.equal(readiness.heartbeatCurrentGapOverThreshold, false);
    assert.equal(readiness.automaticFreezeAuthorized, false);
    assert.equal(readiness.outcomeDataRead, false);
    assert.equal(readiness.validationDataRead, false);
    assert.equal(readiness.holdoutDataRead, false);
    assert.equal(readiness.rawOddsValuesRead, false);
    assert.equal(readiness.networkRequestCount, 0);
    assert.equal(readiness.databaseReadCount, 0);
    assert.equal(readiness.databaseWriteCount, 0);
    assert.equal(readiness.currentBuyConnectionAuthorized, false);
    assert.equal(readiness.lineConnectionAuthorized, false);
    assert.equal(readiness.publicPublishAuthorized, false);
    assert.match(readiness.outputDigest, /^[0-9a-f]{64}$/u);
    assert.doesNotMatch(JSON.stringify(readiness), /syntheticSnapshotIndex|fromCheckpointLabel|toCheckpointLabel/u);
  });
});

test("readiness artifact is immutable mode0600 and idempotent for the same digest", () => {
  withRoot((root) => {
    seedIndex(root);
    seedHealthyHeartbeat(root);
    const readiness = buildN2TrifectaPrivateMarketDailyReadiness({
      dataRoot: root,
      date: "2026-08-07",
      venueCode: "10",
      checkedAt: "2026-08-07T02:10:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness });
    const second = writeN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.outputDigest, second.outputDigest);
    const path = join(root, first.relativePath);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.outputDigest, readiness.outputDigest);
  });
});

test("tampered day index fails closed before readiness is produced", () => {
  withRoot((root) => {
    const relativePath = seedIndex(root);
    seedHealthyHeartbeat(root);
    const path = join(root, relativePath);
    const index = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    index.passCount = 12;
    writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    chmodSync(path, 0o600);

    assert.throws(
      () => buildN2TrifectaPrivateMarketDailyReadiness({
        dataRoot: root,
        date: "2026-08-07",
        venueCode: "10",
        checkedAt: "2026-08-07T02:10:00.000Z",
      }),
      /DAILY_READINESS_DAY_INDEX_DIGEST_MISMATCH/u,
    );
  });
});
