import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-features.ts"),
  "utf8",
);

test("private market feature CLI has no network or database dependency", () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
  assert.match(source, /networkRequestCount:\s*0/u);
  assert.match(source, /databaseReadCount:\s*0/u);
  assert.match(source, /databaseWriteCount:\s*0/u);
});

test("full feature artifact can only be written under data private", () => {
  assert.match(source, /"data",\s*\n\s*"private",\s*\n\s*"trifecta-market-features"/u);
  assert.match(source, /openSync\(path, "wx", 0o600\)/u);
  assert.match(source, /privateResearchOnly:\s*true/u);
  assert.match(source, /publicPublishAuthorized:\s*false/u);
  assert.match(source, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(source, /lineConnectionAuthorized:\s*false/u);
  assert.match(source, /automatedBettingAuthorized:\s*false/u);
});

test("stdout summary explicitly suppresses raw odds values", () => {
  assert.match(source, /rawOddsValuesPrinted:\s*false/u);
  assert.match(source, /rawOddsValuesPublished:\s*false/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*sequence/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*selections/u);
});
