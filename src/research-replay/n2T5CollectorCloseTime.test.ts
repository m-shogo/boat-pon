import assert from "node:assert/strict";
import test from "node:test";
import { n2T5CollectorCloseTime } from "./n2T5CollectorCloseTime";

test("collector close time accepts canonical JST clock values", () => {
  assert.equal(n2T5CollectorCloseTime("2026-08-28", "00:00").toISOString(), "2026-08-27T15:00:00.000Z");
  assert.equal(n2T5CollectorCloseTime("2026-08-28", "23:59").toISOString(), "2026-08-28T14:59:00.000Z");
  assert.equal(n2T5CollectorCloseTime("2026-08-28", "12:34:56").toISOString(), "2026-08-28T03:34:56.000Z");
});

test("collector close time rejects malformed or impossible values", () => {
  for (const [date, closeAt] of [
    ["2026-02-30", "12:00"],
    ["2026-08-28", "24:00"],
    ["2026-08-28", "12:60"],
    ["2026-08-28", "12:34:60"],
    ["2026-08-28", "9:30"],
    ["2026-08-28", "not-a-time"],
  ]) {
    assert.throws(
      () => n2T5CollectorCloseTime(date, closeAt),
      new RegExp(`N2_T5_COLLECTOR_CLOSE_AT_INVALID:${date}:${closeAt}`),
    );
  }
});
