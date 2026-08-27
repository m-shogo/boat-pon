import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { n2CanonicalT5ForwardCaptureTimingHavingSql } from "./n2T5ForwardCaptureTimingSql";

function acceptedMinutes(values: Array<number | string | null>): boolean {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE snapshots(minutes_before_close INTEGER)");
  const insert = db.prepare("INSERT INTO snapshots(minutes_before_close) VALUES (?)");
  for (const value of values) insert.run(value);
  const having = n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close");
  const row = db.prepare(`SELECT COUNT(*) AS n FROM snapshots HAVING ${having}`).get() as { n: number } | undefined;
  db.close();
  return row !== undefined;
}

test("T-5 forward capture timing requires one canonical persisted minute", () => {
  assert.equal(acceptedMinutes([5, 5, 5]), true);
  assert.equal(acceptedMinutes([0, 0]), true);
  assert.equal(acceptedMinutes([10, 10]), true);
  assert.equal(acceptedMinutes([5, 6]), false);
  assert.equal(acceptedMinutes([5, 20]), false);
  assert.equal(acceptedMinutes([5, null]), false);
  assert.equal(acceptedMinutes(["not-a-minute", "not-a-minute"]), false);
});

test("T-5 forward timing SQL rejects unsafe column fragments", () => {
  assert.doesNotThrow(() => n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close"));
  assert.throws(
    () => n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close) OR 1=1 --"),
    /N2_T5_FORWARD_CAPTURE_TIMING_COLUMN_INVALID/u,
  );
});
