import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { n2CanonicalT5CoverageTimingSql } from "./n2T5MarketCoverageTimingSql";

test("T-5 market coverage timing SQL accepts only persisted T-5 minute values", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE samples(value)");
  const insert = db.prepare("INSERT INTO samples(value) VALUES (?)");
  for (const value of [0, 5, 10, -1, 11, 5.5, "5", null]) insert.run(value);
  const predicate = n2CanonicalT5CoverageTimingSql("value");
  const rows = db.prepare(`SELECT value FROM samples WHERE ${predicate} ORDER BY value`).all() as Array<{ value: number }>;
  db.close();
  assert.deepEqual(rows.map((row) => row.value), [0, 5, 10]);
});

test("T-5 market coverage timing SQL only accepts safe internal column identifiers", () => {
  assert.doesNotThrow(() => n2CanonicalT5CoverageTimingSql("o.minutes_before_close"));
  assert.throws(
    () => n2CanonicalT5CoverageTimingSql("o.minutes_before_close) OR 1=1 --"),
    /N2_T5_MARKET_COVERAGE_TIMING_COLUMN_INVALID/u,
  );
});
