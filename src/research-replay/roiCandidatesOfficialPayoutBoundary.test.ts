import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-candidates.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI candidate command fails closed instead of ranking on current odds", () => {
  assert.equal(pkg.scripts?.["analyze:roi-candidates"], "tsx scripts/analyze-roi-candidates.ts");
  assert.match(entrypoint, /ROI_CANDIDATES_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
});
