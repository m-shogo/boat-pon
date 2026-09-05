import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("roi improvement validation fails closed when official payout coverage is incomplete", () => {
  const source = readFileSync("scripts/analyze-roi-improvement-validation.ts", "utf8");

  assert.match(source, /missingPayoutRaces: number/);
  assert.match(source, /const payoutComplete = missingPayoutRaces === 0/);
  assert.match(source, /roi: payoutComplete && stake \?/);
  assert.match(source, /top2ExclRoi: payoutComplete && stake \?/);
  assert.match(source, /const complete = \[d, v, t\]\.every\(x => x\.missingPayoutRaces === 0\)/);
  assert.match(source, /払戻欠落・未判定/);
  assert.match(source, /PRAGMA query_only = ON/);
});
