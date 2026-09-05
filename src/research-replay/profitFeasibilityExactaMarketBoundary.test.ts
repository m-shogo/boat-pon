import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("profit feasibility uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/audit-profit-feasibility.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\(\)/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 30/);
});

test("profit feasibility verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/audit-profit-feasibility.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /PROFIT_FEASIBILITY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\("data\/boat\.sqlite"/);
});
