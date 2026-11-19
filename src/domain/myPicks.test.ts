import assert from "node:assert/strict";
import test from "node:test";
import { isTrifectaSelection, parseSelections, recordedBeforeClose, summarizeMyPicks } from "./myPicks";

test("3連単の買い目の形", () => {
  assert.equal(isTrifectaSelection("1-2-3"), true);
  assert.equal(isTrifectaSelection("1-1-3"), false);
  assert.equal(isTrifectaSelection("1-2-7"), false);
  assert.deepEqual(parseSelections("1-2-3, 1-3-2 1－2－3"), ["1-2-3", "1-3-2"]);
  assert.throws(() => parseSelections("1-2"));
});

test("締切より前に記録したものだけ数える", () => {
  assert.equal(recordedBeforeClose("2026-11-19T06:15:59Z", "2026-11-19", "15:16"), true);
  assert.equal(recordedBeforeClose("2026-11-19T06:16:00Z", "2026-11-19", "15:16"), false);
});

test("採点: 実際の的中と市場の見込み、回収率", () => {
  const s = summarizeMyPicks([
    { status: "hit", marketProbability: 0.2, payoutYen: 600 },
    { status: "miss", marketProbability: 0.1, payoutYen: null },
    { status: "returned", marketProbability: 0.1, payoutYen: null },
    { status: "pending", marketProbability: null, payoutYen: null },
  ]);
  assert.equal(s.settled, 2);
  assert.equal(s.hits, 1);
  assert.ok(Math.abs(s.marketExpectedHits! - 0.3) < 1e-9);
  assert.ok(Math.abs(s.actualToMarket! - 1 / 0.3) < 1e-9);
  assert.equal(s.officialRoi, 3);
});
