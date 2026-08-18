import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalUtcTimestamp } from "./canonical";
import { loadN2TrifectaPrivateMarketFeatures } from
  "./n2TrifectaPrivateMarketFeatureLoader";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from
  "./n2TrifectaPrivateMarketFeatureArtifact";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex";
import { readN2TrifectaPrivateDailyPlanCache } from "./n2TrifectaPrivateDailyPlanCache";

export const N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION =
  "n2-trifecta-private-market-feature-rollup-v1" as const;

export type N2TrifectaPrivateMarketFeatureRollupRace = {
  raceNo: number;
  raceIdentity: string;
  status: "PASS" | "PARTIAL" | "NO_DATA" | "BLOCKED";
  acceptedMarkerCount: number;
  loadedSnapshotCount: number;
  transitionCount: number;
  availableCheckpoints: string[];
  missingCheckpoints: string[];
  artifactChanged: boolean;
  artifactReused: boolean;
  artifactReplacedExisting: boolean;
};

export type N2TrifectaPrivateMarketFeatureRollupReport = {
  reportVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION;
  status: "PASS" | "PARTIAL" | "NO_DATA" | "NO_CHANGE" | "BLOCKED";
  blockers: string[];
  checkedAt: string;
  date: string;
  venueCode: string | null;
  sourcePlanDigest: string | null;
  raceCount: 12;
  passCount: number;
  partialCount: number;
  noDataCount: number;
  blockedCount: number;
  acceptedMarkerCount: number;
  loadedSnapshotCount: number;
  transitionCount: number;
  artifactChangedCount: number;
  artifactReusedCount: number;
  artifactReplacedExistingCount: number;
  indexWritten: boolean;
  indexChanged: boolean;
  indexRelativePath: string | null;
  indexDigest: string | null;
  races: N2TrifectaPrivateMarketFeatureRollupRace[];
  privateResearchOnly: true;
  rawCaptureEvidenceMayBeReadPrivately: true;
  rawOddsValuesPrinted: false;
  rawOddsValuesPublished: false;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  automatedBettingChanged: false;
  productionApplyExecuted: false;
};

function currentJstDate(now: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(now);
}

function fixedBoundary(input: Omit<
  N2TrifectaPrivateMarketFeatureRollupReport,
  | "privateResearchOnly"
  | "rawCaptureEvidenceMayBeReadPrivately"
  | "rawOddsValuesPrinted"
  | "rawOddsValuesPublished"
  | "networkRequestCount"
  | "databaseReadCount"
  | "databaseWriteCount"
  | "currentBuyChanged"
  | "lineChanged"
  | "publicPublished"
  | "automatedBettingChanged"
  | "productionApplyExecuted"
>): N2TrifectaPrivateMarketFeatureRollupReport {
  return {
    ...input,
    privateResearchOnly: true,
    rawCaptureEvidenceMayBeReadPrivately: true,
    rawOddsValuesPrinted: false,
    rawOddsValuesPublished: false,
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    currentBuyChanged: false,
    lineChanged: false,
    publicPublished: false,
    automatedBettingChanged: false,
    productionApplyExecuted: false,
  };
}

export function runN2TrifectaPrivateMarketFeatureRollup(input: {
  dataRoot: string;
  now: string;
}): N2TrifectaPrivateMarketFeatureRollupReport {
  let normalizedNow: string;
  try {
    normalizedNow = canonicalUtcTimestamp(input.now);
  } catch {
    throw new Error("FEATURE_ROLLUP_NOW_INVALID");
  }
  const nowMs = Date.parse(normalizedNow);
  const date = currentJstDate(new Date(nowMs));
  const dataRoot = resolve(input.dataRoot);
  const planPath = resolve(dataRoot, `data/private/trifecta-capture/plans/${date}.json`);

  const empty = {
    reportVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION,
    checkedAt: normalizedNow,
    date,
    venueCode: null,
    sourcePlanDigest: null,
    raceCount: 12 as const,
    passCount: 0,
    partialCount: 0,
    noDataCount: 12,
    blockedCount: 0,
    acceptedMarkerCount: 0,
    loadedSnapshotCount: 0,
    transitionCount: 0,
    artifactChangedCount: 0,
    artifactReusedCount: 0,
    artifactReplacedExistingCount: 0,
    indexWritten: false,
    indexChanged: false,
    indexRelativePath: null,
    indexDigest: null,
    races: [] as N2TrifectaPrivateMarketFeatureRollupRace[],
  };

  if (!existsSync(planPath)) {
    return fixedBoundary({
      ...empty,
      status: "NO_CHANGE",
      blockers: ["PRIVATE_DAILY_PLAN_NOT_AVAILABLE"],
    });
  }

  const planRead = readN2TrifectaPrivateDailyPlanCache({
    dataRoot,
    expectedDate: date,
    now: normalizedNow,
  });
  if (planRead.status !== "PASS" || !planRead.plan) {
    return fixedBoundary({
      ...empty,
      status: "BLOCKED",
      blockers: ["PRIVATE_DAILY_PLAN_INVALID", ...planRead.blockers.map((code) => `PLAN_${code}`)],
    });
  }

  const venueCodes = [...new Set(planRead.plan.entries.map((entry) => entry.venueCode))].sort();
  const raceNumbers = [...new Set(planRead.plan.entries.map((entry) => entry.raceNo))].sort((a, b) => a - b);
  if (venueCodes.length !== 1 || raceNumbers.length !== 12
    || raceNumbers.some((raceNo, index) => raceNo !== index + 1)) {
    return fixedBoundary({
      ...empty,
      status: "BLOCKED",
      blockers: ["PRIVATE_DAILY_PLAN_SCOPE_INVALID"],
      sourcePlanDigest: planRead.plan.manifestDigest,
    });
  }

  const venueCode = venueCodes[0];
  const races: N2TrifectaPrivateMarketFeatureRollupRace[] = [];
  const blockers: string[] = [];
  let passCount = 0;
  let partialCount = 0;
  let noDataCount = 0;
  let blockedCount = 0;
  let acceptedMarkerCount = 0;
  let loadedSnapshotCount = 0;
  let transitionCount = 0;
  let artifactChangedCount = 0;
  let artifactReusedCount = 0;
  let artifactReplacedExistingCount = 0;

  for (let raceNo = 1; raceNo <= 12; raceNo += 1) {
    let report: ReturnType<typeof loadN2TrifectaPrivateMarketFeatures>;
    try {
      report = loadN2TrifectaPrivateMarketFeatures({
        rootDir: dataRoot,
        date,
        venueCode,
        raceNo,
      });
    } catch {
      blockedCount += 1;
      blockers.push(`R${String(raceNo).padStart(2, "0")}_FEATURE_LOAD_FAILED`);
      races.push({
        raceNo,
        raceIdentity: `${date.replaceAll("-", "")}-${venueCode}-${String(raceNo).padStart(2, "0")}`,
        status: "BLOCKED",
        acceptedMarkerCount: 0,
        loadedSnapshotCount: 0,
        transitionCount: 0,
        availableCheckpoints: [],
        missingCheckpoints: [],
        artifactChanged: false,
        artifactReused: false,
        artifactReplacedExisting: false,
      });
      continue;
    }

    acceptedMarkerCount += report.acceptedMarkerCount;
    loadedSnapshotCount += report.loadedSnapshotCount;
    transitionCount += report.sequence.transitions.length;
    let artifactChanged = false;
    let artifactReused = false;
    let artifactReplacedExisting = false;

    if (report.status === "PASS") passCount += 1;
    else if (report.status === "PARTIAL") partialCount += 1;
    else if (report.status === "NO_DATA") noDataCount += 1;
    else {
      blockedCount += 1;
      blockers.push(...report.blockers.map((code) => `R${String(raceNo).padStart(2, "0")}_${code}`));
    }

    if (report.status === "PASS" || report.status === "PARTIAL") {
      try {
        const write = writeN2TrifectaPrivateMarketFeatureArtifact({
          rootDir: dataRoot,
          report,
          generatedAt: normalizedNow,
        });
        artifactChanged = write.changed;
        artifactReused = !write.changed;
        artifactReplacedExisting = write.changed && write.replacedExisting;
        if (artifactChanged) artifactChangedCount += 1;
        if (artifactReused) artifactReusedCount += 1;
        if (artifactReplacedExisting) artifactReplacedExistingCount += 1;
      } catch {
        blockedCount += 1;
        blockers.push(`R${String(raceNo).padStart(2, "0")}_FEATURE_WRITE_FAILED`);
      }
    }

    races.push({
      raceNo,
      raceIdentity: report.raceIdentity,
      status: report.status,
      acceptedMarkerCount: report.acceptedMarkerCount,
      loadedSnapshotCount: report.loadedSnapshotCount,
      transitionCount: report.sequence.transitions.length,
      availableCheckpoints: [...report.sequence.availableCheckpoints],
      missingCheckpoints: [...report.sequence.missingCheckpoints],
      artifactChanged,
      artifactReused,
      artifactReplacedExisting,
    });
  }

  if (blockedCount > 0) {
    return fixedBoundary({
      reportVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION,
      status: "BLOCKED",
      blockers: [...new Set(blockers)].sort(),
      checkedAt: normalizedNow,
      date,
      venueCode,
      sourcePlanDigest: planRead.plan.manifestDigest,
      raceCount: 12,
      passCount,
      partialCount,
      noDataCount,
      blockedCount,
      acceptedMarkerCount,
      loadedSnapshotCount,
      transitionCount,
      artifactChangedCount,
      artifactReusedCount,
      artifactReplacedExistingCount,
      indexWritten: false,
      indexChanged: false,
      indexRelativePath: null,
      indexDigest: null,
      races,
    });
  }

  let indexWritten = false;
  let indexChanged = false;
  let indexRelativePath: string | null = null;
  let indexDigest: string | null = null;
  try {
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: dataRoot,
      date,
      venueCode,
      generatedAt: normalizedNow,
    });
    const write = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: dataRoot, index });
    indexWritten = true;
    indexChanged = write.changed;
    indexRelativePath = write.relativePath;
    indexDigest = write.indexDigest;
  } catch {
    return fixedBoundary({
      reportVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION,
      status: "BLOCKED",
      blockers: ["PRIVATE_DAY_INDEX_REFRESH_FAILED"],
      checkedAt: normalizedNow,
      date,
      venueCode,
      sourcePlanDigest: planRead.plan.manifestDigest,
      raceCount: 12,
      passCount,
      partialCount,
      noDataCount,
      blockedCount: 1,
      acceptedMarkerCount,
      loadedSnapshotCount,
      transitionCount,
      artifactChangedCount,
      artifactReusedCount,
      artifactReplacedExistingCount,
      indexWritten: false,
      indexChanged: false,
      indexRelativePath: null,
      indexDigest: null,
      races,
    });
  }

  const status = passCount === 12
    ? "PASS" as const
    : passCount === 0 && partialCount === 0
      ? "NO_DATA" as const
      : "PARTIAL" as const;
  return fixedBoundary({
    reportVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ROLLUP_VERSION,
    status,
    blockers: [],
    checkedAt: normalizedNow,
    date,
    venueCode,
    sourcePlanDigest: planRead.plan.manifestDigest,
    raceCount: 12,
    passCount,
    partialCount,
    noDataCount,
    blockedCount: 0,
    acceptedMarkerCount,
    loadedSnapshotCount,
    transitionCount,
    artifactChangedCount,
    artifactReusedCount,
    artifactReplacedExistingCount,
    indexWritten,
    indexChanged,
    indexRelativePath,
    indexDigest,
    races,
  });
}
