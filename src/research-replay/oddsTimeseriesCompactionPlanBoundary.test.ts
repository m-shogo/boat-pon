import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/plan-odds-timeseries-compaction.ts", "utf8");

test("odds timeseries compaction plan verifies canonical DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(identity >= 0, "canonical single-link regular-file identity must be checked");
  assert.ok(open > identity, "SQLite must only open the verified canonical path");
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
});

test("odds timeseries compaction plan does not expose configured private DB paths", () => {
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /statSync\(verifiedDbPath\)/);
  assert.doesNotMatch(source, /statSync\(DB_PATH\)/);
});
