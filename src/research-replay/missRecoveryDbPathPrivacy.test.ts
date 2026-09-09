import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");

test("miss recovery wrapper keeps configured database paths out of missing-file errors", () => {
  assert.match(source, /throw new Error\("MISS_RECOVERY_DB_NOT_FOUND"\)/u);
  assert.doesNotMatch(source, /MISS_RECOVERY_DB_NOT_FOUND \$\{DB_PATH\}/u);
});

test("miss recovery wrapper preserves canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});
