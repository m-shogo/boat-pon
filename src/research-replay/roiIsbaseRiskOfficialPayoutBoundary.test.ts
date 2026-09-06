import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-isbase-risk.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal isBase risk command fails closed instead of classifying cuts on current odds", () => {
  assert.equal(pkg.scripts?.["analyze:roi-isbase-risk"], "tsx scripts/analyze-roi-isbase-risk.ts");
  assert.match(entrypoint, /ROI_ISBASE_RISK_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
});
