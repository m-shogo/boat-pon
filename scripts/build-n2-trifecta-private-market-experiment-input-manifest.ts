import { resolve } from "node:path";

import {
  buildN2TrifectaPrivateMarketExperimentInputManifest,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
  type N2TrifectaExperimentInputScope,
} from "../src/research-replay/n2TrifectaPrivateMarketExperimentInputManifest";

function repeatedArgument(name: string): string[] {
  const values: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === `--${name}`) {
      const next = process.argv[index + 1];
      if (next) values.push(next);
      index += 1;
    } else if (value.startsWith(`--${name}=`)) {
      values.push(value.slice(name.length + 3));
    }
  }
  return values;
}

function parseScope(value: string): N2TrifectaExperimentInputScope {
  const match = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4])$/u.exec(value);
  if (!match) throw new Error(`invalid --index scope: ${value}`);
  return { date: match[1], venueCode: match[2] };
}

const scopeValues = repeatedArgument("index");
if (scopeValues.length === 0) {
  console.error("usage: tsx scripts/build-n2-trifecta-private-market-experiment-input-manifest.ts --index YYYY-MM-DD:VV [--index YYYY-MM-DD:VV ...] [--write-private]");
  process.exit(2);
}

let scopes: N2TrifectaExperimentInputScope[];
try {
  scopes = scopeValues.map(parseScope);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const rootDir = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const writePrivate = process.argv.includes("--write-private");
const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({ rootDir, scopes });
const writeResult = writePrivate
  ? writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir, manifest })
  : null;

// Stdout contains lineage/cohort metadata only; feature vectors and labels stay unread here.
const sanitized = {
  summaryVersion: "n2-trifecta-private-market-experiment-input-summary-v1",
  manifestVersion: manifest.manifestVersion,
  evidenceRole: manifest.evidenceRole,
  coveragePolicy: manifest.coveragePolicy,
  labelPolicy: manifest.labelPolicy,
  selectionPolicy: manifest.selectionPolicy,
  sourceAsOf: manifest.sourceAsOf,
  sourceIndices: manifest.sourceIndices,
  raceCount: manifest.raceCount,
  races: manifest.races.map((race) => ({
    raceIdentity: race.raceIdentity,
    date: race.date,
    venueCode: race.venueCode,
    raceNo: race.raceNo,
    checkpointCoverage: race.checkpointCoverage,
    sourceLoadDigest: race.sourceLoadDigest,
    featureArtifactDigest: race.featureArtifactDigest,
    featureArtifactVersion: race.featureArtifactVersion,
    featureArtifactRelativePath: race.featureArtifactRelativePath,
  })),
  manifestDigest: manifest.manifestDigest,
  privateWriteRequested: writePrivate,
  privateManifestWrittenOrReused: writeResult != null,
  privateManifestCreated: writeResult?.created ?? false,
  privateManifestRelativePath: writeResult?.relativePath ?? null,
  dayIndexFilesRead: manifest.sourceIndices.length,
  privateFeatureArtifactsRead: false,
  rawCaptureEvidenceRead: false,
  rawOddsValuesPrinted: false,
  rawOddsValuesPublished: false,
  outcomeDataRead: false,
  validationDataRead: false,
  holdoutDataRead: false,
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
