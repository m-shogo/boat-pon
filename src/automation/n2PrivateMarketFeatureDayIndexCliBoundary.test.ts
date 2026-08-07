import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const cli = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-feature-day-index.ts"),
  "utf8",
);
const indexSource = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketFeatureDayIndex.ts"),
  "utf8",
);

test("day index CLI has no network or database dependency", () => {
  assert.doesNotMatch(cli, /\bfetch\s*\(/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
  assert.match(cli, /networkRequestCount:\s*0/u);
  assert.match(cli, /databaseReadCount:\s*0/u);
  assert.match(cli, /databaseWriteCount:\s*0/u);
});

test("day index stdout is metadata-only and explicitly suppresses odds values", () => {
  assert.match(cli, /rawCaptureEvidenceRead:\s*false/u);
  assert.match(cli, /rawOddsValuesPrinted:\s*false/u);
  assert.match(cli, /rawOddsValuesPublished:\s*false/u);
  assert.doesNotMatch(cli, /sequence:\s*race/u);
  assert.doesNotMatch(cli, /snapshots:\s*race/u);
  assert.doesNotMatch(cli, /transitions:\s*race/u);
  assert.doesNotMatch(cli, /selections:\s*race/u);
});

test("private day index path and writer remain bounded and mode0600", () => {
  assert.match(indexSource, /data\/private\/trifecta-market-features\/\$\{input\.date\}\/\$\{input\.venueCode\}\/index\.json/u);
  assert.match(indexSource, /openSync\(temp, "wx", 0o600\)/u);
  assert.match(indexSource, /fsyncSync\(fd\)/u);
  assert.match(indexSource, /renameSync\(temp, path\)/u);
  assert.match(indexSource, /chmodSync\(path, 0o600\)/u);
  assert.match(indexSource, /privateResearchOnly:\s*true/u);
  assert.match(indexSource, /publicPublishAuthorized:\s*false/u);
  assert.match(indexSource, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(indexSource, /lineConnectionAuthorized:\s*false/u);
  assert.match(indexSource, /automatedBettingAuthorized:\s*false/u);
});
