import assert from "node:assert/strict";
import {
  chmodSync,
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

import { canonicalHash } from "./canonical";
import {
  N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
  type N2TrifectaPrivateMarketDailyReadiness,
  type N2TrifectaPrivateMarketDailyReadinessStatus,
} from "./n2TrifectaPrivateMarketDailyReadiness";
import {
  buildN2TrifectaPrivateMarketReadinessCatalog,
  writeN2TrifectaPrivateMarketReadinessCatalog,
} from "./n2TrifectaPrivateMarketReadinessCatalog";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readiness(input: {
  date: string;
  venueCode: string;
  checkedAt: string;
  complete: number;
  partial: number;
  noData: number;
  snapshots: number;
  transitions: number;
  status?: N2TrifectaPrivateMarketDailyReadinessStatus;
}): N2TrifectaPrivateMarketDailyReadiness {
  const candidates = Array.from({ length: input.complete }, (_, index) =>
    `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(index + 1).padStart(2, "0")}`);
  const core = {
    readinessVersion: N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
    evidenceRole: "EXPLORATION_READINESS_ONLY" as const,
    checkedAt: input.checkedAt,
    date: input.date,
    venueCode: input.venueCode,
    status: input.status ?? "DEGRADED" as N2TrifectaPrivateMarketDailyReadinessStatus,
    blockers: [] as string[],
    sourceDayIndexVersion: "n2-trifecta-private-market-feature-day-index-v1" as const,
    sourceDayIndexDigest: canonicalHash({ date: input.date, venueCode: input.venueCode, checkedAt: input.checkedAt }),
    sourceDayIndexGeneratedAt: input.checkedAt,
    sourceDayIndexStatus: input.snapshots === 48 ? "PASS" as const : input.snapshots === 0 ? "NO_DATA" as const : "PARTIAL" as const,
    completeRaceCount: input.complete,
    partialRaceCount: input.partial,
    noDataRaceCount: input.noData,
    cohortCandidateRaceCount: candidates.length,
    cohortCandidateRaceIdentities: candidates,
    totalSnapshotCount: input.snapshots,
    totalTransitionCount: input.transitions,
    checkpointCoverageNumerator: input.snapshots,
    checkpointCoverageDenominator: 48 as const,
    checkpointCoverageRatio: Number((input.snapshots / 48).toFixed(6)),
    heartbeatStatus: "PASS" as const,
    heartbeatOutputDigest: canonicalHash({ heartbeat: input.checkedAt }),
    heartbeatHistoryRecordCount: 100,
    heartbeatLatestAgeSeconds: 20,
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

function writeReadiness(root: string, artifact: N2TrifectaPrivateMarketDailyReadiness): string {
  const relativePath = `data/private/trifecta-market-experiments/readiness/${artifact.date}/${artifact.venueCode}/${artifact.outputDigest}.json`;
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return relativePath;
}

test("catalog chooses latest verified readiness per date and venue", () => {
  withRoot((root) => {
    writeReadiness(root, readiness({
      date: "2026-08-07", venueCode: "10", checkedAt: "2026-08-07T04:00:00.000Z",
      complete: 5, partial: 5, noData: 2, snapshots: 31, transitions: 21,
    }));
    const latest = readiness({
      date: "2026-08-07", venueCode: "10", checkedAt: "2026-08-07T05:00:00.000Z",
      complete: 7, partial: 4, noData: 1, snapshots: 38, transitions: 27,
    });
    writeReadiness(root, latest);
    writeReadiness(root, readiness({
      date: "2026-08-06", venueCode: "19", checkedAt: "2026-08-06T14:45:00.000Z",
      complete: 12, partial: 0, noData: 0, snapshots: 48, transitions: 36, status: "PASS",
    }));

    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-07T05:10:00.000Z",
    });

    assert.equal(catalog.sourceArtifactCount, 3);
    assert.equal(catalog.entryCount, 2);
    assert.equal(catalog.earliestDate, "2026-08-06");
    assert.equal(catalog.latestDate, "2026-08-07");
    assert.equal(catalog.fullCoverageScopeCount, 1);
    const current = catalog.entries.find((entry) => entry.date === "2026-08-07" && entry.venueCode === "10");
    assert.ok(current);
    assert.equal(current.latestCheckedAt, latest.checkedAt);
    assert.equal(current.readinessDigest, latest.outputDigest);
    assert.equal(current.completeRaceCount, 7);
    assert.equal(current.checkpointCoverageNumerator, 38);
    assert.equal(current.scopeArtifactCount, 2);
    assert.equal(catalog.automaticFreezeAuthorized, false);
    assert.equal(catalog.outcomeDataRead, false);
    assert.equal(catalog.validationDataRead, false);
    assert.equal(catalog.holdoutDataRead, false);
    assert.equal(catalog.networkRequestCount, 0);
    assert.equal(catalog.databaseReadCount, 0);
    assert.equal(catalog.databaseWriteCount, 0);
    assert.doesNotMatch(JSON.stringify(catalog), /"odds"\s*:|"selections"\s*:|"moves"\s*:|"payout"\s*:|"roi"\s*:/u);
  });
});

test("catalog writer keeps digest stable when only generatedAt changes", () => {
  withRoot((root) => {
    writeReadiness(root, readiness({
      date: "2026-08-07", venueCode: "10", checkedAt: "2026-08-07T05:00:00.000Z",
      complete: 7, partial: 4, noData: 1, snapshots: 38, transitions: 27,
    }));
    const firstCatalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-07T05:10:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: firstCatalog });
    const laterCatalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-07T05:20:00.000Z",
    });
    assert.notEqual(firstCatalog.catalogDigest, laterCatalog.catalogDigest);
    const second = writeN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: laterCatalog });
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.catalogDigest, first.catalogDigest);
    const path = join(root, second.relativePath);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.catalogDigest, first.catalogDigest);
    assert.equal(disk.generatedAt, firstCatalog.generatedAt);
  });
});

test("tampered readiness artifact fails closed", () => {
  withRoot((root) => {
    const relativePath = writeReadiness(root, readiness({
      date: "2026-08-07", venueCode: "10", checkedAt: "2026-08-07T05:00:00.000Z",
      complete: 7, partial: 4, noData: 1, snapshots: 38, transitions: 27,
    }));
    const path = join(root, relativePath);
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    value.completeRaceCount = 12;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    chmodSync(path, 0o600);
    assert.throws(
      () => buildN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, generatedAt: "2026-08-07T05:10:00.000Z" }),
      /READINESS_CATALOG_ARTIFACT_DIGEST_MISMATCH/u,
    );
  });
});

test("permission-widened readiness artifact fails closed", () => {
  withRoot((root) => {
    const relativePath = writeReadiness(root, readiness({
      date: "2026-08-07", venueCode: "10", checkedAt: "2026-08-07T05:00:00.000Z",
      complete: 7, partial: 4, noData: 1, snapshots: 38, transitions: 27,
    }));
    chmodSync(join(root, relativePath), 0o644);
    assert.throws(
      () => buildN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, generatedAt: "2026-08-07T05:10:00.000Z" }),
      /READINESS_CATALOG_ARTIFACT_FILE_MODE_INVALID/u,
    );
  });
});
