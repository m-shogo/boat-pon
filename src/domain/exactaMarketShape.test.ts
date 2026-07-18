import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjacentSecondRatio, buildExactaMarketShape } from "./exactaMarketShape";

function fullMarket() {
  const rows: Array<{ combination: string; odds: number }> = [];
  for (let first = 1; first <= 6; first++) for (let second = 1; second <= 6; second++) {
    if (first !== second) rows.push({ combination: `${first}-${second}`, odds: 30 });
  }
  return rows;
}

describe("buildExactaMarketShape", () => {
  it("全30通りを正規化し、人気順位・1着艇mass・有効選択肢数を返す", () => {
    const rows = fullMarket();
    rows.find((row) => row.combination === "1-4")!.odds = 10;
    const shape = buildExactaMarketShape(rows)!;
    assert.ok(Math.abs([...shape.probabilities.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.equal(shape.ranks.get("1-4"), 1);
    assert.ok(shape.firstCourseMass.get("1")! > shape.firstCourseMass.get("2")!);
    assert.ok(shape.effectiveSelections < 30);
  });

  it("欠損・重複marketを拒否する", () => {
    assert.equal(buildExactaMarketShape(fullMarket().slice(1)), null);
    const duplicated = fullMarket();
    duplicated[0] = duplicated[1];
    assert.equal(buildExactaMarketShape(duplicated), null);
  });
});

describe("adjacentSecondRatio", () => {
  it("隣接する2着艇の平均確率との比を返す", () => {
    const rows = fullMarket();
    rows.find((row) => row.combination === "1-4")!.odds = 10;
    assert.ok(Math.abs(adjacentSecondRatio(buildExactaMarketShape(rows)!, "1-4")! - 3) < 1e-9);
  });
});
