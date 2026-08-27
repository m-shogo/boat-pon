import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical forward validates persisted race-result identity before cohort use", () => {
  const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");
  const resultLoader = source.slice(source.indexOf("function loadResults"), source.indexOf("function loadExhibitions"));

  assert.match(source, /validateT5MarketBaselineResultIdentityRows/);
  assert.match(resultLoader, /validateT5MarketBaselineResultIdentityRows/);
  assert.match(resultLoader, /SELECT race_id, date, venue, race_no, trifecta, payout_yen, returned/);
});
