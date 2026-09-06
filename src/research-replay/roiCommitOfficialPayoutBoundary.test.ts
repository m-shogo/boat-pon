import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-commit.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI commit review fails closed instead of proposing NO_BUY from current odds", () => {
  assert.equal(pkg.scripts?.["analyze:roi-commit"], "tsx scripts/analyze-roi-commit.ts");
  assert.match(entrypoint, /ROI_COMMIT_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official `race_payouts\.payout_yen`/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
});
