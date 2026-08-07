import { resolve } from "node:path";

import { readN2TrifectaPrivateDailyPlanCache } from
  "../src/research-replay/n2TrifectaPrivateDailyPlanCache";
import {
  buildN2TrifectaPrivateMarketDailyReadiness,
  writeN2TrifectaPrivateMarketDailyReadiness,
} from "../src/research-replay/n2TrifectaPrivateMarketDailyReadiness";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function jstDate(value: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(value);
}

const checkedAtArg = argument("checked-at");
const checkedAtDate = checkedAtArg == null ? new Date() : new Date(checkedAtArg);
if (!Number.isFinite(checkedAtDate.getTime())) {
  console.error("invalid --checked-at");
  process.exit(2);
}
const checkedAt = checkedAtDate.toISOString();
const date = argument("date") ?? jstDate(checkedAtDate);
if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
  console.error("invalid --date");
  process.exit(2);
}
const dataRoot = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
let venueCode = argument("venue");
if (venueCode == null) {
  const planRead = readN2TrifectaPrivateDailyPlanCache({
    dataRoot,
    expectedDate: date,
    now: checkedAt,
  });
  const venues = planRead.plan == null
    ? []
    : [...new Set(planRead.plan.entries.map((entry) => entry.venueCode))].sort();
  if (planRead.status !== "PASS" || venues.length !== 1) {
    console.error(`current private daily plan unavailable: ${planRead.status}:${planRead.blockers.join(",")}`);
    process.exit(3);
  }
  venueCode = venues[0];
}
if (!/^(0[1-9]|1\d|2[0-4])$/u.test(venueCode)) {
  console.error("invalid --venue");
  process.exit(2);
}

const readiness = buildN2TrifectaPrivateMarketDailyReadiness({
  dataRoot,
  date,
  venueCode,
  checkedAt,
});
const writePrivate = process.argv.includes("--write-private");
const writeResult = writePrivate
  ? writeN2TrifectaPrivateMarketDailyReadiness({ dataRoot, readiness })
  : null;

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-daily-readiness-summary-v1",
  readinessVersion: readiness.readinessVersion,
  evidenceRole: readiness.evidenceRole,
  checkedAt: readiness.checkedAt,
  date: readiness.date,
  venueCode: readiness.venueCode,
  status: readiness.status,
  blockers: readiness.blockers,
  sourceDayIndexDigest: readiness.sourceDayIndexDigest,
  sourceDayIndexStatus: readiness.sourceDayIndexStatus,
  completeRaceCount: readiness.completeRaceCount,
  partialRaceCount: readiness.partialRaceCount,
  noDataRaceCount: readiness.noDataRaceCount,
  cohortCandidateRaceCount: readiness.cohortCandidateRaceCount,
  cohortCandidateRaceIdentities: readiness.cohortCandidateRaceIdentities,
  totalSnapshotCount: readiness.totalSnapshotCount,
  totalTransitionCount: readiness.totalTransitionCount,
  checkpointCoverageNumerator: readiness.checkpointCoverageNumerator,
  checkpointCoverageDenominator: readiness.checkpointCoverageDenominator,
  checkpointCoverageRatio: readiness.checkpointCoverageRatio,
  heartbeatStatus: readiness.heartbeatStatus,
  heartbeatOutputDigest: readiness.heartbeatOutputDigest,
  heartbeatHistoryRecordCount: readiness.heartbeatHistoryRecordCount,
  heartbeatLatestAgeSeconds: readiness.heartbeatLatestAgeSeconds,
  heartbeatSignificantGapCount: readiness.heartbeatSignificantGapCount,
  heartbeatRecentSignificantGapCount: readiness.heartbeatRecentSignificantGapCount,
  heartbeatAffectedCheckpointCount: readiness.heartbeatAffectedCheckpointCount,
  heartbeatCurrentGapOverThreshold: readiness.heartbeatCurrentGapOverThreshold,
  heartbeatPlanStatus: readiness.heartbeatPlanStatus,
  automaticFreezeAuthorized: readiness.automaticFreezeAuthorized,
  privateWriteRequested: writePrivate,
  privateReadinessWrittenOrReused: writeResult != null,
  privateReadinessCreated: writeResult?.created ?? false,
  privateReadinessRelativePath: writeResult?.relativePath ?? null,
  outputDigest: readiness.outputDigest,
  outcomeDataRead: readiness.outcomeDataRead,
  validationDataRead: readiness.validationDataRead,
  holdoutDataRead: readiness.holdoutDataRead,
  rawCaptureEvidenceRead: readiness.rawCaptureEvidenceRead,
  rawOddsValuesRead: readiness.rawOddsValuesRead,
  rawOddsValuesPrinted: readiness.rawOddsValuesPrinted,
  rawOddsValuesPublished: readiness.rawOddsValuesPublished,
  networkRequestCount: readiness.networkRequestCount,
  databaseReadCount: readiness.databaseReadCount,
  databaseWriteCount: readiness.databaseWriteCount,
  currentBuyConnectionAuthorized: readiness.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: readiness.lineConnectionAuthorized,
  automatedBettingAuthorized: readiness.automatedBettingAuthorized,
  publicPublishAuthorized: readiness.publicPublishAuthorized,
  productionApplyAuthorized: readiness.productionApplyAuthorized,
};
console.log(JSON.stringify(sanitized, null, 2));
if (readiness.status === "BLOCKED") process.exitCode = 3;
