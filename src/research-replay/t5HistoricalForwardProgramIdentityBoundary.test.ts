import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical forward validates persisted program identity before maturity and cohort use", () => {
  const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");
  const programLoader = source.slice(source.indexOf("function loadPrograms"), source.indexOf("function loadResults"));

  assert.match(source, /validateT5MarketCoverageProgramRows/);
  assert.match(programLoader, /validateT5MarketCoverageProgramRows/);
  assert.match(programLoader, /SELECT race_id, date, venue, race_no, close_at, raw_json/);
});
