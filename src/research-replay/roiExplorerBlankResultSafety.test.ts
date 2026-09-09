import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "scripts/explore-roi.ts"), "utf8");

test("ROI explorer fail-closes blank settled BUY results before evaluation", () => {
  assert.match(source, /AND dh\.result IS NOT NULL\n\), invalid AS/);
  assert.match(source, /WHERE TRIM\(s\.result\) = ''\n     OR s\.payout_bet_type IS NULL/);
  assert.doesNotMatch(source, /AND dh\.result != ''\n\), invalid AS/);
  assert.match(source, /ROI_EXPLORER_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

test("ROI explorer payout lookup defensively excludes whitespace results", () => {
  assert.match(source, /dh\.result IS NOT NULL AND TRIM\(dh\.result\) != '' AND dh\.selection = dh\.result/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
});
