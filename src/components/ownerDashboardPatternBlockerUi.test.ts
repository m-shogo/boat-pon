import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Owner dashboard explains public-safe BUY contrast blockers without segment identity", () => {
  const source = readFileSync("src/components/OwnerDashboardSummary.tsx", "utf8");
  assert.match(source, /Contrast blocker/u);
  assert.match(source, /Universal eligible/u);
  assert.match(source, /Closest complement/u);
  assert.match(source, /Complement shortfall/u);
  assert.match(source, /全件同一区分 \/ 比較不能/u);
  assert.match(source, /比較側の母数不足/u);
  assert.match(source, /segment側の母数不足/u);
  assert.match(source, /`あと\$\{value\}`/u);
  assert.doesNotMatch(source, /patternSupport\.segmentKey|patternSupport\.venue|patternSupport\.modelVersion/u);
});
