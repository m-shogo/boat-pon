import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialProgramsText } from "./officialProgramParser.js";

test("venue switch flushes the previous venue final race before changing venue", () => {
  const text = [
    "ボートレース大村   8月7日",
    "  12R 優勝戦          H1800m  電話投票締切予定20:45",
    "ボートレース芦屋   8月7日",
    "   1R 一般            H1800m  電話投票締切予定08:40",
  ].join("\n");

  const rows = parseOfficialProgramsText(text, { date: "2026-08-07" });
  assert.deepEqual(
    rows.map((row) => ({ venue: row.venue, raceNo: row.raceNo, closeAt: row.closeAt })),
    [
      { venue: "大村", raceNo: 12, closeAt: "20:45" },
      { venue: "芦屋", raceNo: 1, closeAt: "08:40" },
    ],
  );
});
