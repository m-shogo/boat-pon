import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const cli = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-exploration-matrix.ts"),
  "utf8",
);
const matrixSource = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketExplorationMatrix.ts"),
  "utf8",
);

test("exploration matrix CLI has no network, database or label dependency", () => {
  assert.doesNotMatch(cli, /\bfetch\s*\(/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
  assert.match(cli, /outcomeDataRead:\s*matrix\.outcomeDataRead/u);
  assert.match(cli, /validationDataRead:\s*matrix\.validationDataRead/u);
  assert.match(cli, /holdoutDataRead:\s*matrix\.holdoutDataRead/u);
  assert.match(cli, /networkRequestCount:\s*matrix\.networkRequestCount/u);
  assert.match(cli, /databaseReadCount:\s*matrix\.databaseReadCount/u);
  assert.match(cli, /databaseWriteCount:\s*matrix\.databaseWriteCount/u);
});

test("exploration matrix stdout exposes schema and lineage but never numeric row values", () => {
  assert.match(cli, /columnCount:\s*matrix\.columns\.length/u);
  assert.match(cli, /columns:\s*matrix\.columns/u);
  assert.match(cli, /matrixValuesPrinted:\s*false/u);
  assert.doesNotMatch(cli, /values:\s*row\.values/u);
  assert.doesNotMatch(cli, /rows:\s*matrix\.rows/u);
  assert.doesNotMatch(cli, /console\.log\([^\n]*matrix/u);
});

test("matrix contract stays exploration-only, unlabeled and production-disconnected", () => {
  assert.match(matrixSource, /evidenceRole:\s*"EXPLORATION_ONLY"/u);
  assert.match(matrixSource, /labelPolicy:\s*"NO_OUTCOME_LABELS"/u);
  assert.match(matrixSource, /coveragePolicy:\s*"FULL_TRAJECTORY_ONLY"/u);
  assert.match(matrixSource, /outcomeDataRead:\s*false/u);
  assert.match(matrixSource, /validationDataRead:\s*false/u);
  assert.match(matrixSource, /holdoutDataRead:\s*false/u);
  assert.match(matrixSource, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(matrixSource, /lineConnectionAuthorized:\s*false/u);
  assert.match(matrixSource, /automatedBettingAuthorized:\s*false/u);
  assert.match(matrixSource, /productionApplyAuthorized:\s*false/u);
});

test("matrix schema excludes selection-level arrays and categorical favorite identity", () => {
  assert.match(matrixSource, /SNAPSHOT_FIELDS/u);
  assert.match(matrixSource, /TRANSITION_FIELDS/u);
  const columnDefinition = matrixSource.slice(
    matrixSource.indexOf("const SNAPSHOT_FIELDS"),
    matrixSource.indexOf("export const N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_DIGEST"),
  );
  assert.doesNotMatch(columnDefinition, /favoriteSelection|selections|moves/u);
  assert.match(matrixSource, /values\.length !== N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS\.length/u);
});

test("private matrices are immutable mode0600 digest-addressed artifacts", () => {
  assert.match(matrixSource, /data\/private\/trifecta-market-experiments\/matrices\/\$\{input\.manifestDigest\}\/\$\{input\.matrixDigest\}\.json/u);
  assert.match(matrixSource, /openSync\(path, "wx", 0o600\)/u);
  assert.match(matrixSource, /EXPLORATION_MATRIX_COLLISION/u);
  assert.doesNotMatch(matrixSource, /renameSync|truncateSync/u);
});
