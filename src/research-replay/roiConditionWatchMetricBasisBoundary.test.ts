import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-roi-condition-watch.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("ROI condition-watch normal entrypoint fails closed until quote-based pseudo-return is rebased to official settlement", () => {
  assert.equal(pkg.scripts?.["report:roi-condition-watch"], "tsx scripts/report-roi-condition-watch.ts");
  assert.match(source, /ROI_CONDITION_WATCH_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /complete canonical official settlement/);
  assert.match(source, /process\.exit\(2\)/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /writeFileSync/);
  assert.doesNotMatch(source, /SUM\(hit \* current_odds\)/);
  assert.doesNotMatch(source, /historical強め候補/);
});
