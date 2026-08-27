import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { n2CanonicalT10CollectorTimingSql } from "./n2T10CollectorTimingSql";

test("canonical T-10 timing accepts only persisted integer 10..15", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE samples(value INTEGER)");
  const insert = db.prepare("INSERT INTO samples(value) VALUES (?)");
  for (const value of [9, 10, 11, 15, 16, 10.5, "not-a-minute", null]) insert.run(value);
  const values = db.prepare(`SELECT value FROM samples WHERE ${n2CanonicalT10CollectorTimingSql("value")} ORDER BY value`).all();
  assert.deepEqual(values.map((row) => (row as { value: number }).value), [10, 11, 15]);
  db.close();
});
