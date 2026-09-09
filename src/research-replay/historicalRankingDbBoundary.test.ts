import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-historical-ranking-forward.ts", "utf8");

test("historical ranking forward requires a canonical read-only database input", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "HISTORICAL_RANKING_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("historical ranking forward does not expose the configured database path when missing", () => {
  assert.match(source, /HISTORICAL_RANKING_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});
