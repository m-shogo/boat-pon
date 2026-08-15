import assert from "node:assert/strict";
import test from "node:test";
import { formatLineDailyLatestHit } from "./lineDailyLatestHit";

test("formats the latest paper-live BUY hit for the private LINE daily summary", () => {
  assert.equal(
    formatLineDailyLatestHit({
      date: "2026-08-15",
      venue: "津",
      raceNo: 6,
      selection: "1-2-3",
      payoutYen: 1_250,
    }),
    "直近的中: 2026-08-15 津 6R 1-2-3 / 公式100円払戻 1,250円",
  );
});

test("makes a no-hit current-cohort state explicit", () => {
  assert.equal(
    formatLineDailyLatestHit(null),
    "直近的中: まだなし（現行paper-live）",
  );
});
