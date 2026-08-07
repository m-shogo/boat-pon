import { resolve } from "node:path";

import { writeN2TrifectaPrivateMarketFeatureArtifact } from
  "../src/research-replay/n2TrifectaPrivateMarketFeatureArtifact";
import { loadN2TrifectaPrivateMarketFeatures } from
  "../src/research-replay/n2TrifectaPrivateMarketFeatureLoader";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const date = argument("date");
const venueCode = argument("venue");
if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
  || !venueCode || !/^(0[1-9]|1\d|2[0-4])$/u.test(venueCode)) {
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-feature-day.ts --date YYYY-MM-DD --venue 01..24 [--write-private]");
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
const races = [];
let passCount = 0;
let partialCount = 0;
let noDataCount = 0;
let blockedCount = 0;
let artifactChangedCount = 0;
let artifactReusedCount = 0;
let artifactReplacedExistingCount = 0;
let loadedSnapshotCount = 0;
let transitionCount = 0;

for (let raceNo = 1; raceNo <= 12; raceNo += 1) {
  const report = loadN2TrifectaPrivateMarketFeatures({
    rootDir,
    date,
    venueCode,
    raceNo,
  });
  if (report.status === "PASS") passCount += 1;
  else if (report.status === "PARTIAL") partialCount += 1;
  else if (report.status === "NO_DATA") noDataCount += 1;
  else blockedCount += 1;
  loadedSnapshotCount += report.loadedSnapshotCount;
  transitionCount += report.sequence.transitions.length;

  const writeResult = writePrivate && (report.status === "PASS" || report.status === "PARTIAL")
    ? writeN2TrifectaPrivateMarketFeatureArtifact({ rootDir, report })
    : null;
  if (writeResult?.changed) artifactChangedCount += 1;
  if (writeResult && !writeResult.changed) artifactReusedCount += 1;
  if (writeResult?.replacedExisting && writeResult.changed) artifactReplacedExistingCount += 1;

  races.push({
    raceNo,
    raceIdentity: report.raceIdentity,
    status: report.status,
    blockers: report.blockers,
    acceptedMarkerCount: report.acceptedMarkerCount,
    loadedSnapshotCount: report.loadedSnapshotCount,
    availableCheckpoints: report.sequence.availableCheckpoints,
    missingCheckpoints: report.sequence.missingCheckpoints,
    transitionCount: report.sequence.transitions.length,
    sourceLoadDigest: report.outputDigest,
    privateArtifact: writeResult == null ? null : {
      relativePath: writeResult.relativePath,
      changed: writeResult.changed,
      replacedExisting: writeResult.replacedExisting,
      artifactDigest: writeResult.artifactDigest,
      fileMode: "0600",
    },
  });
}

const status = blockedCount > 0
  ? "BLOCKED" as const
  : passCount === 12
    ? "PASS" as const
    : passCount === 0 && partialCount === 0
      ? "NO_DATA" as const
      : "PARTIAL" as const;

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-feature-day-summary-v1",
  status,
  date,
  venueCode,
  raceCount: 12,
  passCount,
  partialCount,
  noDataCount,
  blockedCount,
  loadedSnapshotCount,
  transitionCount,
  privateOutputRequested: writePrivate,
  artifactChangedCount,
  artifactReusedCount,
  artifactReplacedExistingCount,
  races,
  networkRequestCount: 0,
  databaseReadCount: 0,
  databaseWriteCount: 0,
  rawOddsValuesReadPrivately: loadedSnapshotCount > 0,
  rawOddsValuesPrinted: false,
  rawOddsValuesPublished: false,
  currentBuyChanged: false,
  lineChanged: false,
  publicPublished: false,
  automatedBettingChanged: false,
  productionApplyExecuted: false,
};
console.log(JSON.stringify(sanitized, null, 2));
if (status === "BLOCKED") process.exit(1);
