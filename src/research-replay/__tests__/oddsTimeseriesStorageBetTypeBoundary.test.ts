import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("odds timeseries storage redundancy key includes bet type", () => {
  const source = readFileSync("scripts/audit-odds-timeseries-storage.ts", "utf8");

  assert.match(source, /COUNT\(DISTINCT race_id \|\| char\(47\) \|\| COALESCE\(bet_type, ''\)/);
  assert.match(source, /race\/bet_type\/checkpoint\/selectionの一意キー/);
});
