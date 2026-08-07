import { resolve } from "node:path";

import { runN2TrifectaPrivateMarketFeatureRollup } from
  "../src/research-replay/n2TrifectaPrivateMarketFeatureRollup";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const nowArg = argument("now");
const now = nowArg == null ? new Date() : new Date(nowArg);
if (!Number.isFinite(now.getTime())) {
  console.error("invalid --now");
  process.exit(2);
}

const dataRoot = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const report = runN2TrifectaPrivateMarketFeatureRollup({
  dataRoot,
  now: now.toISOString(),
});

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-feature-rollup-summary-v1",
  reportVersion: report.reportVersion,
  status: report.status,
  blockers: report.blockers,
  checkedAt: report.checkedAt,
  date: report.date,
  venueCode: report.venueCode,
  sourcePlanDigest: report.sourcePlanDigest,
  raceCount: report.raceCount,
  passCount: report.passCount,
  partialCount: report.partialCount,
  noDataCount: report.noDataCount,
  blockedCount: report.blockedCount,
  acceptedMarkerCount: report.acceptedMarkerCount,
  loadedSnapshotCount: report.loadedSnapshotCount,
  transitionCount: report.transitionCount,
  artifactChangedCount: report.artifactChangedCount,
  artifactReusedCount: report.artifactReusedCount,
  artifactReplacedExistingCount: report.artifactReplacedExistingCount,
  indexWritten: report.indexWritten,
  indexChanged: report.indexChanged,
  indexRelativePath: report.indexRelativePath,
  indexDigest: report.indexDigest,
  races: report.races.map((race) => ({
    raceNo: race.raceNo,
    raceIdentity: race.raceIdentity,
    status: race.status,
    acceptedMarkerCount: race.acceptedMarkerCount,
    loadedSnapshotCount: race.loadedSnapshotCount,
    transitionCount: race.transitionCount,
    availableCheckpoints: race.availableCheckpoints,
    missingCheckpoints: race.missingCheckpoints,
    artifactChanged: race.artifactChanged,
    artifactReused: race.artifactReused,
    artifactReplacedExisting: race.artifactReplacedExisting,
  })),
  privateResearchOnly: report.privateResearchOnly,
  rawCaptureEvidenceMayBeReadPrivately: report.rawCaptureEvidenceMayBeReadPrivately,
  rawOddsValuesPrinted: report.rawOddsValuesPrinted,
  rawOddsValuesPublished: report.rawOddsValuesPublished,
  networkRequestCount: report.networkRequestCount,
  databaseReadCount: report.databaseReadCount,
  databaseWriteCount: report.databaseWriteCount,
  currentBuyChanged: report.currentBuyChanged,
  lineChanged: report.lineChanged,
  publicPublished: report.publicPublished,
  automatedBettingChanged: report.automatedBettingChanged,
  productionApplyExecuted: report.productionApplyExecuted,
};
console.log(JSON.stringify(sanitized, null, 2));
if (report.status === "BLOCKED") process.exitCode = 3;
