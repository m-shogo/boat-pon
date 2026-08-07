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
const raceNo = Number(argument("race"));
if (!date || !venueCode || !Number.isSafeInteger(raceNo)) {
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-features.ts --date YYYY-MM-DD --venue 01..24 --race 1..12 [--write-private]");
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
const report = loadN2TrifectaPrivateMarketFeatures({
  rootDir,
  date,
  venueCode,
  raceNo,
});

const writeResult = writePrivate && (report.status === "PASS" || report.status === "PARTIAL")
  ? writeN2TrifectaPrivateMarketFeatureArtifact({ rootDir, report })
  : null;

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-feature-summary-v2",
  status: report.status,
  blockers: report.blockers,
  date: report.date,
  venueCode: report.venueCode,
  raceNo: report.raceNo,
  raceIdentity: report.raceIdentity,
  acceptedMarkerCount: report.acceptedMarkerCount,
  loadedSnapshotCount: report.loadedSnapshotCount,
  availableCheckpoints: report.sequence.availableCheckpoints,
  missingCheckpoints: report.sequence.missingCheckpoints,
  transitionCount: report.sequence.transitions.length,
  sourceLoadDigest: report.outputDigest,
  privateOutputRequested: writePrivate,
  privateOutputEligible: report.status === "PASS" || report.status === "PARTIAL",
  privateOutputWrittenOrReused: writeResult != null,
  privateOutputChanged: writeResult?.changed ?? false,
  privateOutputReplacedExisting: writeResult?.replacedExisting ?? false,
  privateOutputRelativePath: writeResult?.relativePath ?? null,
  privateArtifactDigest: writeResult?.artifactDigest ?? null,
  networkRequestCount: 0,
  databaseReadCount: 0,
  databaseWriteCount: 0,
  rawOddsValuesPrinted: false,
  rawOddsValuesPublished: false,
  currentBuyChanged: false,
  lineChanged: false,
  publicPublished: false,
  automatedBettingChanged: false,
  productionApplyExecuted: false,
};
console.log(JSON.stringify(sanitized, null, 2));
if (report.status === "BLOCKED") process.exit(1);
