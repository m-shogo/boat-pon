import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical ranking validates program identity before train/forward split", () => {
  const source = readFileSync("scripts/analyze-historical-ranking-forward.ts", "utf8");
  const sourceLoader = source.slice(source.indexOf("const sourceRows"), source.indexOf("const exhibitionRows"));

  assert.match(source, /validateT5MarketCoverageProgramRows/);
  assert.match(sourceLoader, /programs\.venue/);
  assert.match(sourceLoader, /programs\.race_no/);
  assert.match(sourceLoader, /validateT5MarketCoverageProgramRows/);
  assert.ok(source.indexOf("validateT5MarketCoverageProgramRows") < source.indexOf("const train = races.filter"));
});
