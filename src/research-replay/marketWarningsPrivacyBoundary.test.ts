import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-market-warnings.ts", "utf8");

test("market warnings verifies canonical read-only DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0, "canonical DB identity check must exist");
  assert.ok(open > identity, "DB must only open after canonical identity verification");
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found:.*DB_PATH/);
});

test("market warnings keeps row-level checkpoint snapshots out of report output", () => {
  assert.doesNotMatch(source, /\bt30Odds\b/);
  assert.doesNotMatch(source, /\bt5Odds\b/);
  assert.doesNotMatch(source, /\bt30Popularity\b/);
  assert.doesNotMatch(source, /\bt5Popularity\b/);
  assert.match(source, /oddsChangeRate/);
  assert.match(source, /popularityDelta/);
  assert.match(source, /row-level T-30\/T-5 odds\/popularity withheld; derived movement only/);
});
