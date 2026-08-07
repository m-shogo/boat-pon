import { resolve } from "node:path";

import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "../src/research-replay/n2TrifectaPrivateMarketFeatureDayIndex";

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
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-feature-day-index.ts --date YYYY-MM-DD --venue 01..24 [--write-private]");
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
  rootDir,
  date,
  venueCode,
});
const writeResult = writePrivate
  ? writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir, index })
  : null;

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-feature-day-index-summary-v1",
  status: index.status,
  date: index.date,
  venueCode: index.venueCode,
  raceCount: index.raceCount,
  passCount: index.passCount,
  partialCount: index.partialCount,
  noDataCount: index.noDataCount,
  totalSnapshotCount: index.totalSnapshotCount,
  totalTransitionCount: index.totalTransitionCount,
  races: index.races.map((race) => ({
    raceNo: race.raceNo,
    raceIdentity: race.raceIdentity,
    status: race.status,
    availableCheckpoints: race.availableCheckpoints,
    missingCheckpoints: race.missingCheckpoints,
    snapshotCount: race.snapshotCount,
    transitionCount: race.transitionCount,
    sourceLoadDigest: race.sourceLoadDigest,
    featureArtifactDigest: race.featureArtifactDigest,
    featureArtifactVersion: race.featureArtifactVersion,
  })),
  privateIndexWriteRequested: writePrivate,
  privateIndexWrittenOrReused: writeResult != null,
  privateIndexChanged: writeResult?.changed ?? false,
  privateIndexRelativePath: writeResult?.relativePath ?? null,
  indexDigest: index.indexDigest,
  privateFeatureArtifactsRead: true,
  rawCaptureEvidenceRead: false,
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
console.log(JSON.stringify(sanitized, null, 2));
