import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("residual forward validates race-result identity before cohort construction", () => {
  const source = readFileSync("scripts/analyze-t5-residual-forward.ts", "utf8");
  const resultsLoad = source.slice(source.indexOf("const results="), source.indexOf("const byRace="));

  assert.match(source, /validateT5MarketBaselineResultIdentityRows/);
  assert.match(resultsLoad, /const results=validateT5MarketBaselineResultIdentityRows\(db\.prepare/);
  assert.ok(
    source.indexOf("validateT5MarketBaselineResultIdentityRows") < source.indexOf("const resultMap="),
    "result identity must be validated before train/forward cohort construction",
  );
});
