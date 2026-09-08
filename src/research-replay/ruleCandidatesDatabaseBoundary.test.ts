import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");

test("rule candidates report keeps the primary DB canonical read-only and does not disclose configured paths", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /RULE_CANDIDATES_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /RULE_CANDIDATES_REPORT_PRIMARY_DB_MISSING/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
