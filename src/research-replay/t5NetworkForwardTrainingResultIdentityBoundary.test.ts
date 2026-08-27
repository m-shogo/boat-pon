import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("network-only forward validates persisted result identity for training and formal cohorts", () => {
  const source = readFileSync("scripts/audit-t5-network-only-forward.ts", "utf8");
  const resultLoader = source.slice(source.indexOf("function loadResults"), source.indexOf("function buildRaces"));

  assert.match(source, /const trainResults = loadResults\(TRAIN_FROM, TRAIN_TO\)/);
  assert.match(source, /const formalResults = loadResults\(formalFromDate, formalToDate\)/);
  assert.match(resultLoader, /validateT5MarketBaselineResultIdentityRows/);
});
