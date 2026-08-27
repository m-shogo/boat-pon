import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalT5CompleteMarketSelections } from "./t5ResidualForwardMarket";

function canonicalSelections(): string[] {
  const output: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        if (first !== second && first !== third && second !== third) {
          output.push(`${first}-${second}-${third}`);
        }
      }
    }
  }
  return output;
}

test("residual forward market accepts the canonical 120 trifecta selections", () => {
  const selections = canonicalSelections();
  assert.equal(selections.length, 120);
  assert.equal(isCanonicalT5CompleteMarketSelections(selections), true);
});

test("residual forward market rejects incomplete or producer-impossible selection sets", () => {
  const selections = canonicalSelections();
  assert.equal(isCanonicalT5CompleteMarketSelections(selections.slice(0, 119)), false);
  assert.equal(isCanonicalT5CompleteMarketSelections([...selections.slice(0, 119), "9-9-9"]), false);
  assert.equal(isCanonicalT5CompleteMarketSelections([...selections.slice(0, 119), "1-1-2"]), false);
});
