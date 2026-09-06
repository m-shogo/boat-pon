import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-decision-lab.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI Decision Lab command fails closed instead of ranking on current odds", () => {
  assert.equal(pkg.scripts?.["analyze:roi-decision-lab"], "tsx scripts/analyze-roi-decision-lab.ts");
  assert.match(entrypoint, /ROI_DECISION_LAB_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official `race_payouts\.payout_yen`/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
});
