import { resolve } from "node:path";

import {
  buildN2TrifectaPrivateMarketExplorationMatrix,
  writeN2TrifectaPrivateMarketExplorationMatrix,
} from "../src/research-replay/n2TrifectaPrivateMarketExplorationMatrix";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const manifestDigest = argument("manifest");
if (!manifestDigest || !/^[0-9a-f]{64}$/u.test(manifestDigest)) {
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-exploration-matrix.ts --manifest <64-hex-digest> [--write-private]");
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir, manifestDigest });
const writeResult = writePrivate
  ? writeN2TrifectaPrivateMarketExplorationMatrix({ rootDir, matrix })
  : null;

// Stdout intentionally exposes schema/lineage only. Numeric matrix row values remain private on disk.
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
