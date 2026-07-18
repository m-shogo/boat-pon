import assert from "node:assert/strict";
import test from "node:test";
import { staticUnconventionalFlags } from "./unconventionalRaceFeatures";

test("当地差・モーター矛盾・周年企画を抽出する", () => {
  const flags = staticUnconventionalFlags({
    raceTitle: "開設70周年記念 優勝戦",
    category: { primary: "企画", tags: ["G1"] },
    boats: [
      { course: 1, className: "A1", nationalWinRate: 6.2, localWinRate: 7.5, motorTop2Rate: 20, boatTop2Rate: 45 },
      { course: 2, className: "B1", nationalWinRate: 4.5 },
      { course: 3, className: "B1", nationalWinRate: 4.4 },
      { course: 4, className: "B1", nationalWinRate: 4.3 },
      { course: 5, className: "B2", nationalWinRate: 4.2 },
      { course: 6, className: "B1", nationalWinRate: 4.1 },
    ],
  });
  assert.ok(flags.includes("当地覚醒_1号艇"));
  assert.ok(flags.includes("強い選手_弱いモーター"));
  assert.ok(flags.includes("周年記念"));
  assert.ok(flags.includes("企画レース"));
  assert.ok(flags.includes("高格付け開催"));
  assert.ok(flags.includes("優勝戦"));
});

test("外枠に最強選手を検出する", () => {
  const flags = staticUnconventionalFlags({ boats: [
    { course: 1, nationalWinRate: 5 }, { course: 2, nationalWinRate: 4 }, { course: 3, nationalWinRate: 4.5 },
    { course: 4, nationalWinRate: 6 }, { course: 5, nationalWinRate: 3 }, { course: 6, nationalWinRate: 3.5 },
  ] });
  assert.ok(flags.includes("外枠に最強選手"));
});
