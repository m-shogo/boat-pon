import assert from "node:assert/strict";
import test from "node:test";
import { eventDayIndex, parseEventStartDate } from "./eventStage";

test("kyotei24開催リンクから初日を読む", () => {
  assert.equal(parseEventStartDate("https://example.test/resultRace-20240912.html"), "2024-09-12");
  assert.equal(parseEventStartDate("https://example.test/resultRace-20280229.html"), "2028-02-29");
  assert.equal(parseEventStartDate("https://example.test/resultRace-20260230.html"), null);
  assert.equal(parseEventStartDate("https://example.test/no-date"), null);
});

test("開催日数をUTC日付差で計算する", () => {
  assert.equal(eventDayIndex("2024-09-12", "2024-09-12"), 1);
  assert.equal(eventDayIndex("2024-09-15", "2024-09-12"), 4);
  assert.equal(eventDayIndex("2024-09-11", "2024-09-12"), null);
  assert.equal(eventDayIndex("2028-03-01", "2028-02-29"), 2);
});

test("開催日数は不可能な暦日を拒否する", () => {
  assert.equal(eventDayIndex("2026-02-30", "2026-02-28"), null);
  assert.equal(eventDayIndex("2026-03-01", "2026-02-30"), null);
  assert.equal(eventDayIndex("2026-04-31", "2026-04-30"), null);
});
