import assert from "node:assert/strict";
import test from "node:test";
import { validateN2T5CollectorCaptureChronology } from "./n2T5CollectorCaptureChronology";

const base = {
  race_id: "20260828-桐生-01",
  date: "2026-08-28",
  close_at: "12:00",
};

test("collector capture chronology accepts producer-consistent T-5 timing", () => {
  validateN2T5CollectorCaptureChronology([
    { ...base, captured_at: "2026-08-28T02:55:00.000Z", minutes_before_close: 5 },
    { ...base, captured_at: "2026-08-28T02:50:24.000Z", minutes_before_close: 10 },
    { ...base, captured_at: "2026-08-28T03:00:00.000Z", minutes_before_close: 0 },
  ]);
});

test("collector capture chronology rejects persisted timing drift", () => {
  assert.throws(
    () => validateN2T5CollectorCaptureChronology([
      { ...base, captured_at: "2026-08-28T02:55:00.000Z", minutes_before_close: 4 },
    ]),
    /N2_T5_COLLECTOR_CAPTURE_CHRONOLOGY_MISMATCH/,
  );
  assert.throws(
    () => validateN2T5CollectorCaptureChronology([
      { ...base, captured_at: "2026-08-28T03:00:30.000Z", minutes_before_close: 0 },
    ]),
    /N2_T5_COLLECTOR_CAPTURE_CHRONOLOGY_MISMATCH/,
  );
  assert.throws(
    () => validateN2T5CollectorCaptureChronology([
      { ...base, captured_at: "not-a-timestamp", minutes_before_close: 5 },
    ]),
    /N2_T5_COLLECTOR_CAPTURE_AT_INVALID/,
  );
});
