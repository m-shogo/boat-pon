import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-decision-lab.ts", "utf8");
const legacy = readFileSync("scripts/analyze-roi-decision-lab-legacy-current-odds.ts", "utf8");

test("normal ROI Decision Lab entrypoint fails closed instead of ranking on current odds", () => {
  assert.match(entrypoint, /ROI_DECISION_LAB_OFFICIAL_PAYOUT_REQUIRED/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /currentOdds/);
});

test("legacy Decision Lab remains explicitly labeled and cannot be mistaken for official-payout ranking", () => {
  assert.match(legacy, /ROI Decision Lab/);
  assert.match(legacy, /的中回収 = current_odds \* 100/);
  assert.match(legacy, /winningPayoutYen: payoutsMap\.get\(d\.race_id\) \?\? null/);
  assert.match(legacy, /const hitOdds = rows\.filter\(\(r\) => r\.hit\)\.map\(\(r\) => r\.currentOdds\)/);
});
