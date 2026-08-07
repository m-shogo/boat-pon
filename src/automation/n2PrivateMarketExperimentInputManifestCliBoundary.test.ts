import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const cli = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-experiment-input-manifest.ts"),
  "utf8",
);
const manifestSource = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketExperimentInputManifest.ts"),
  "utf8",
);

test("experiment input CLI has no network or database dependency", () => {
  assert.doesNotMatch(cli, /\bfetch\s*\(/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
  assert.match(cli, /networkRequestCount:\s*0/u);
  assert.match(cli, /databaseReadCount:\s*0/u);
  assert.match(cli, /databaseWriteCount:\s*0/u);
});

test("experiment input CLI is index-only and does not read labels, holdout or feature vectors", () => {
  assert.match(cli, /dayIndexFilesRead:/u);
  assert.match(cli, /privateFeatureArtifactsRead:\s*false/u);
  assert.match(cli, /rawCaptureEvidenceRead:\s*false/u);
  assert.match(cli, /outcomeDataRead:\s*false/u);
  assert.match(cli, /validationDataRead:\s*false/u);
  assert.match(cli, /holdoutDataRead:\s*false/u);
  assert.match(cli, /rawOddsValuesPrinted:\s*false/u);
  assert.match(cli, /rawOddsValuesPublished:\s*false/u);
  assert.doesNotMatch(cli, /sequence:\s*race|snapshots:\s*race|transitions:\s*race|selections:\s*race|odds:\s*race/u);
});

test("manifest contract fixes exploration-only full-trajectory unlabeled cohort", () => {
  assert.match(manifestSource, /evidenceRole:\s*"EXPLORATION_ONLY"/u);
  assert.match(manifestSource, /coveragePolicy:\s*"FULL_TRAJECTORY_ONLY"/u);
  assert.match(manifestSource, /labelPolicy:\s*"NO_OUTCOME_LABELS"/u);
  assert.match(manifestSource, /selectionPolicy:\s*"ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES"/u);
  assert.match(manifestSource, /outcomeDataRead:\s*false/u);
  assert.match(manifestSource, /holdoutDataRead:\s*false/u);
  assert.match(manifestSource, /validationDataRead:\s*false/u);
  assert.match(manifestSource, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(manifestSource, /lineConnectionAuthorized:\s*false/u);
  assert.match(manifestSource, /automatedBettingAuthorized:\s*false/u);
  assert.match(manifestSource, /productionApplyAuthorized:\s*false/u);
});

test("private experiment input manifests are immutable mode0600 digest-addressed files", () => {
  assert.match(manifestSource, /data\/private\/trifecta-market-experiments\/manifests\/\$\{manifestDigest\}\.json/u);
  assert.match(manifestSource, /openSync\(path, "wx", 0o600\)/u);
  assert.doesNotMatch(manifestSource, /renameSync|truncateSync/u);
  assert.match(manifestSource, /EXPERIMENT_INPUT_MANIFEST_COLLISION/u);
});
