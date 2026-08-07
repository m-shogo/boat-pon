import {
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { loadN2TrifectaPrivateMarketFeatures } from
  "../src/research-replay/n2TrifectaPrivateMarketFeatureLoader";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveInside(rootDir: string, relativePath: string): string {
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PRIVATE_FEATURE_PATH_ESCAPES_ROOT");
  }
  return target;
}

function exclusivePrivateWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
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

let privateOutputRelativePath: string | null = null;
if (writePrivate && (report.status === "PASS" || report.status === "PARTIAL")) {
  privateOutputRelativePath = [
    "data",
    "private",
    "trifecta-market-features",
    date,
    venueCode,
    `${String(raceNo).padStart(2, "0")}.json`,
  ].join("/");
  const privateOutputPath = resolveInside(rootDir, privateOutputRelativePath);
  exclusivePrivateWrite(privateOutputPath, `${JSON.stringify({
    featureArtifactVersion: "n2-trifecta-private-market-feature-artifact-v1",
    generatedAt: new Date().toISOString(),
    sourceLoadDigest: report.outputDigest,
    raceIdentity: report.raceIdentity,
    status: report.status,
    sequence: report.sequence,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
  }, null, 2)}\n`);
}

const sanitized = {
  summaryVersion: "n2-trifecta-private-market-feature-summary-v1",
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
  privateOutputWritten: privateOutputRelativePath != null,
  privateOutputRelativePath,
  networkRequestCount: 0,
  databaseReadCount: 0,
  databaseWriteCount: 0,
  rawOddsValuesPrinted: false,
  rawOddsValuesPublished: false,
  publicPublishAuthorized: false,
};
console.log(JSON.stringify(sanitized, null, 2));
if (report.status === "BLOCKED") process.exit(1);
