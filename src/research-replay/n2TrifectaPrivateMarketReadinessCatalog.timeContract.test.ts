import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
  type N2TrifectaPrivateMarketDailyReadiness,
} from "./n2TrifectaPrivateMarketDailyReadiness.js";
import { buildN2TrifectaPrivateMarketReadinessCatalog } from
  "./n2TrifectaPrivateMarketReadinessCatalog.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-time-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function noDataReadiness(input: {
  date: string;
  checkedAt: string;
}): N2TrifectaPrivateMarketDailyReadiness {
  const core = {
    readinessVersion: N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
    evidenceRole: "EXPLORATION_READINESS_ONLY" as const,
    checkedAt: input.checkedAt,
    date: input.date,
    venueCode: "10",
    status: "NO_DATA" as const,
    blockers: [] as string[],
    sourceDayIndexVersion: "n2-trifecta-private-market-feature-day-index-v1" as const,
    sourceDayIndexDigest: canonicalHash({ date: input.date, source: "day-index" }),
    sourceDayIndexGeneratedAt: "2026-08-08T00:00:00.000Z",
    sourceDayIndexStatus: "NO_DATA" as const,
    completeRaceCount: 0,
    partialRaceCount: 0,
    noDataRaceCount: 12,
    cohortCandidateRaceCount: 0,
    cohortCandidateRaceIdentities: [] as string[],
    totalSnapshotCount: 0,
    totalTransitionCount: 0,
    checkpointCoverageNumerator: 0,
    checkpointCoverageDenominator: 48 as const,
    checkpointCoverageRatio: 0,
    heartbeatStatus: "PASS" as const,
    heartbeatOutputDigest: canonicalHash({ checkedAt: input.checkedAt, source: "heartbeat" }),
    heartbeatHistoryRecordCount: 1,
    heartbeatLatestAgeSeconds: 0,
    heartbeatSignificantGapCount: 0,
    heartbeatRecentSignificantGapCount: 0,
    heartbeatAffectedCheckpointCount: 0,
    heartbeatCurrentGapOverThreshold: false,
    heartbeatPlanStatus: "PASS" as const,
    automaticFreezeAuthorized: false as const,
    outcomeDataRead: false as const,
    validationDataRead: false as const,
    holdoutDataRead: false as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesRead: false as const,
    rawOddsValuesPrinted: false as const,
    rawOddsValuesPublished: false as const,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    publicPublishAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function writeReadiness(root: string, artifact: N2TrifectaPrivateMarketDailyReadiness): void {
  const path = join(
    root,
    "data/private/trifecta-market-experiments/readiness",
    artifact.date,
    artifact.venueCode,
    `${artifact.outputDigest}.json`,
  );
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

test("rejects rehashed readiness artifacts with normalized checkedAt before latest selection", () => {
  withRoot((root) => {
    writeReadiness(root, noDataReadiness({
      date: "2026-08-08",
      checkedAt: "2026-08-07T24:00:00.000Z",
    }));

    assert.throws(
      () => buildN2TrifectaPrivateMarketReadinessCatalog({
        dataRoot: root,
        generatedAt: "2026-08-08T01:00:00.000Z",
      }),
      /READINESS_CATALOG_ARTIFACT_CHECKED_AT_INVALID/u,
    );
  });
});

test("rejects normalized catalog generatedAt but canonicalizes valid explicit offsets", () => {
  withRoot((root) => {
    for (const generatedAt of [
      "2026-08-07T24:00:00.000Z",
      "2026-02-30T05:10:00.000Z",
      "2026-08-07T05:10:00",
    ]) {
      assert.throws(
        () => buildN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, generatedAt }),
        /READINESS_CATALOG_GENERATED_AT_INVALID/u,
      );
    }

    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-07T14:10:00+09:00",
    });
    assert.equal(catalog.generatedAt, "2026-08-07T05:10:00.000Z");
  });
});
