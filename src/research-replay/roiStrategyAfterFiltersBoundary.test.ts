import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-strategy-after-filters.ts", "utf8");

test("ROI strategy analysis verifies canonical DB identity and never emits the private DB path", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "ROI_STRATEGY_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.match(source, /dbIdentity: "verified-canonical-research-db"/);
});

test("motor and boat enrichment joins by race_id plus selected head course", () => {
  assert.match(source, /SELECT dh\.id, dh\.race_id AS raceId/);
  assert.match(source, /const raceId = String\(row\.raceId\)/);
  assert.match(source, /mb\.get\(`\$\{raceId\}:\$\{head\}`\)/);
  assert.doesNotMatch(source, /byRaceKey/);
  assert.doesNotMatch(source, /const key = `\$\{String\(row\.id\)\}:\$\{head\}`/);
});
