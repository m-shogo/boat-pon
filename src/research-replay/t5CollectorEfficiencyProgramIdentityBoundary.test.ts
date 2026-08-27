import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("T-5 collector efficiency validates denominator program identity", () => {
  const source = readFileSync("scripts/audit-t5-collector-efficiency.ts", "utf8");

  assert.match(source, /validateT5MarketCoverageProgramRows/);
  assert.match(source, /SELECT date, race_id, venue, race_no, close_at/);
  assert.match(source, /validateT5MarketCoverageProgramRows\(db\.prepare/);
});
