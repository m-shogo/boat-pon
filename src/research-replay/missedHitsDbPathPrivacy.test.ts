import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-missed-hits.ts", "utf8");

test("missed hits report keeps configured database paths out of missing-file errors", () => {
  assert.match(source, /MISSED_HITS_REPORT_PRIMARY_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

test("missed hits report preserves canonical read-only database boundaries and settled-hit population", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /"selection = result", "returned = 0", "decision IN \('WATCH', 'SKIP'\)"/u);
});
