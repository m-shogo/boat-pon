import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const perRaceCli = read("scripts/build-n2-trifecta-private-market-features.ts");
const dayBatchCli = read("scripts/build-n2-trifecta-private-market-feature-day.ts");
const artifactWriter = read("src/research-replay/n2TrifectaPrivateMarketFeatureArtifact.ts");

for (const [name, source] of [
  ["per-race", perRaceCli],
  ["day-batch", dayBatchCli],
] as const) {
  test(`${name} private market feature CLI has no network or database dependency`, () => {
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
    assert.doesNotMatch(source, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
    assert.match(source, /networkRequestCount:\s*0/u);
    assert.match(source, /databaseReadCount:\s*0/u);
    assert.match(source, /databaseWriteCount:\s*0/u);
  });

  test(`${name} stdout summary explicitly suppresses raw odds values`, () => {
    assert.match(source, /rawOddsValuesPrinted:\s*false/u);
    assert.match(source, /rawOddsValuesPublished:\s*false/u);
    assert.doesNotMatch(source, /console\.log\([^\n]*sequence/u);
    assert.doesNotMatch(source, /console\.log\([^\n]*selections/u);
  });
}

test("CLIs delegate private writes to the shared bounded artifact writer", () => {
  assert.match(perRaceCli, /writeN2TrifectaPrivateMarketFeatureArtifact/u);
  assert.match(dayBatchCli, /writeN2TrifectaPrivateMarketFeatureArtifact/u);
  assert.doesNotMatch(perRaceCli, /openSync|writeFileSync|renameSync/u);
  assert.doesNotMatch(dayBatchCli, /openSync|writeFileSync|renameSync/u);
});

test("shared full feature artifact writer is fixed under data private and atomic mode0600", () => {
  assert.match(artifactWriter, /"data",\s*\n\s*"private",\s*\n\s*"trifecta-market-features"/u);
  assert.match(artifactWriter, /openSync\(temporary, "wx", 0o600\)/u);
  assert.match(artifactWriter, /fsyncSync\(fd\)/u);
  assert.match(artifactWriter, /renameSync\(temporary, path\)/u);
  assert.match(artifactWriter, /chmodSync\(path, 0o600\)/u);
  assert.match(artifactWriter, /privateResearchOnly:\s*true/u);
  assert.match(artifactWriter, /publicPublishAuthorized:\s*false/u);
  assert.match(artifactWriter, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(artifactWriter, /lineConnectionAuthorized:\s*false/u);
  assert.match(artifactWriter, /automatedBettingAuthorized:\s*false/u);
});
