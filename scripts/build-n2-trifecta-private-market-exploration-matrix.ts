import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  buildN2TrifectaPrivateMarketExplorationMatrix,
} from "../src/research-replay/n2TrifectaPrivateMarketExplorationMatrix";
import {
  writeVerifiedN2TrifectaPrivateMarketExplorationMatrix,
} from "../src/research-replay/n2TrifectaPrivateMarketExplorationMatrixWriteBoundary";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function assertPrivateInputSingleLinks(rootDir: string, manifestDigest: string): void {
  const root = resolve(rootDir);
  const manifestPath = resolve(
    root,
    "data/private/trifecta-market-experiments/manifests",
    `${manifestDigest}.json`,
  );
  if (!existsSync(manifestPath)) return;
  const manifestLst = lstatSync(manifestPath);
  if (manifestLst.isSymbolicLink() || !manifestLst.isFile()) return;
  const manifestStat = statSync(manifestPath);
  if (manifestStat.nlink !== 1) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_HARDLINK_NOT_ALLOWED");
  }
  if (manifestStat.size <= 0 || manifestStat.size > 5_000_000) return;

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return;
  }
  if (typeof manifest !== "object" || manifest == null || Array.isArray(manifest)) return;
  const races = (manifest as { races?: unknown }).races;
  if (!Array.isArray(races)) return;

  for (const race of races) {
    if (typeof race !== "object" || race == null || Array.isArray(race)) continue;
    const relativePath = (race as { featureArtifactRelativePath?: unknown }).featureArtifactRelativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) continue;
    const featurePath = resolve(root, relativePath);
    if (featurePath === root || !featurePath.startsWith(`${root}${sep}`)) continue;
    if (!existsSync(featurePath)) continue;
    const featureLst = lstatSync(featurePath);
    if (featureLst.isSymbolicLink() || !featureLst.isFile()) continue;
    if (statSync(featurePath).nlink !== 1) {
      throw new Error("EXPLORATION_MATRIX_FEATURE_HARDLINK_NOT_ALLOWED");
    }
  }
}

const manifestDigest = argument("manifest");
if (!manifestDigest || !/^[0-9a-f]{64}$/u.test(manifestDigest)) {
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-exploration-matrix.ts --manifest <64-hex-digest> [--write-private]");
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
assertPrivateInputSingleLinks(rootDir, manifestDigest);
const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir, manifestDigest });
const writeResult = writePrivate
  ? writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir, matrix })
  : null;

// Stdout intentionally exposes schema and lineage metadata only; all 85 numeric values per race stay in the private matrix file.
const sanitized = {
  summaryVersion: "n2-trifecta-private-market-exploration-matrix-summary-v1",
  matrixVersion: matrix.matrixVersion,
  evidenceRole: matrix.evidenceRole,
  labelPolicy: matrix.labelPolicy,
  coveragePolicy: matrix.coveragePolicy,
  manifestDigest: matrix.manifestDigest,
  manifestVersion: matrix.manifestVersion,
  sourceAsOf: matrix.sourceAsOf,
  featureSchemaVersion: matrix.featureSchemaVersion,
  featureSchemaDigest: matrix.featureSchemaDigest,
  columnCount: matrix.columns.length,
  columns: matrix.columns,
  raceCount: matrix.raceCount,
  races: matrix.rows.map((row) => ({
    raceIdentity: row.raceIdentity,
    featureArtifactDigest: row.featureArtifactDigest,
    sourceLoadDigest: row.sourceLoadDigest,
  })),
  matrixDigest: matrix.matrixDigest,
  privateWriteRequested: writePrivate,
  privateMatrixWrittenOrReused: writeResult != null,
  privateMatrixCreated: writeResult?.created ?? false,
  privateMatrixRelativePath: writeResult?.relativePath ?? null,
  privateFeatureArtifactsRead: matrix.privateFeatureArtifactsRead,
  rawCaptureEvidenceRead: matrix.rawCaptureEvidenceRead,
  matrixValuesPrinted: false,
  rawOddsValuesPublished: matrix.rawOddsValuesPublished,
  outcomeDataRead: matrix.outcomeDataRead,
  validationDataRead: matrix.validationDataRead,
  holdoutDataRead: matrix.holdoutDataRead,
  networkRequestCount: matrix.networkRequestCount,
  databaseReadCount: matrix.databaseReadCount,
  databaseWriteCount: matrix.databaseWriteCount,
  currentBuyChanged: false,
  lineChanged: false,
  publicPublished: false,
  automatedBettingChanged: false,
  productionApplyExecuted: false,
};
console.log(JSON.stringify(sanitized, null, 2));
