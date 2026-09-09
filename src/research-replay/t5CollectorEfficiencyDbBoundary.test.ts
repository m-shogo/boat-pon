import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-collector-efficiency.ts", "utf8");

test("T-5 collector efficiency preserves a canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "T5_COLLECTOR_EFFICIENCY_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("T-5 collector efficiency does not expose the configured database path on missing DB", () => {
  assert.match(source, /T5_COLLECTOR_EFFICIENCY_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});
