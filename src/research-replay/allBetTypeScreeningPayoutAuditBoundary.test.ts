import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("all-bet-type screening payout audit accepts legitimate multi-line settlements but rejects malformed lines", () => {
  const source = readFileSync("scripts/audit-all-bet-type-screening-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /GROUP BY rp\.race_id, rp\.bet_type/);
  assert.match(source, /COUNT\(\*\) >= 1/);
  assert.match(source, /COUNT\(\*\) = COUNT\(DISTINCT rp\.combination\)/);
  assert.match(source, /rp\.returned = 1 OR rp\.payout_yen > 0/);
  assert.doesNotMatch(source, /SELECT DISTINCT rp\.race_id, rp\.bet_type/);
  assert.doesNotMatch(source, /COUNT\(\*\) = 1/);
});
