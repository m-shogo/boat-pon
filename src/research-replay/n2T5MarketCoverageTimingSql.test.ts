import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { n2CanonicalT5SelectionSql } from "./n2T5CollectorSelectionSql";
import { n2CanonicalT5CoverageTimingSql } from "./n2T5MarketCoverageTimingSql";

test("T-5 market coverage timing SQL accepts only persisted T-5 minute values", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE samples(value)");
  const insert = db.prepare("INSERT INTO samples(value) VALUES (?)");
  for (const value of [2, 5, 10, 0, 1, 11, 5.5, "5", null]) insert.run(value);
  const predicate = n2CanonicalT5CoverageTimingSql("value");
  const rows = db.prepare(`SELECT value FROM samples WHERE ${predicate} ORDER BY value`).all() as Array<{ value: number }>;
  db.close();
  assert.deepEqual(rows.map((row) => row.value), [2, 5, 10]);
});

test("T-5 full-market counting rejects mixed or mislabeled timing evidence", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE snapshots(selection TEXT NOT NULL, minutes_before_close)");
  const insert = db.prepare("INSERT INTO snapshots(selection, minutes_before_close) VALUES (?, ?)");
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        if (first === second || first === third || second === third) continue;
        insert.run(`${first}-${second}-${third}`, 5);
      }
    }
  }
  const selectionPredicate = n2CanonicalT5SelectionSql("selection");
  const timingPredicate = n2CanonicalT5CoverageTimingSql("minutes_before_close");
  const count = () => (db.prepare(`
    SELECT CASE
      WHEN row_count = selections
        AND selections = canonical_t5_selections
        AND row_count = canonical_timing_rows
        AND timing_values = 1
      THEN canonical_t5_selections
      ELSE 0
    END AS n FROM (
      SELECT
        COUNT(*) AS row_count,
        COUNT(DISTINCT selection) AS selections,
        COUNT(DISTINCT CASE WHEN ${selectionPredicate} AND ${timingPredicate} THEN selection END) AS canonical_t5_selections,
        SUM(CASE WHEN ${timingPredicate} THEN 1 ELSE 0 END) AS canonical_timing_rows,
        COUNT(DISTINCT minutes_before_close) AS timing_values
      FROM snapshots
    )
  `).get() as { n: number }).n;

  assert.equal(count(), 120);
  db.prepare("UPDATE snapshots SET minutes_before_close = 20 WHERE selection = '1-2-3'").run();
  assert.equal(count(), 0);
  db.prepare("UPDATE snapshots SET minutes_before_close = 5").run();
  db.prepare("UPDATE snapshots SET minutes_before_close = 6 WHERE selection = '1-2-3'").run();
  assert.equal(count(), 0);
  db.close();
});

test("T-5 market coverage timing SQL only accepts safe internal column identifiers", () => {
  assert.doesNotThrow(() => n2CanonicalT5CoverageTimingSql("o.minutes_before_close"));
  assert.throws(
    () => n2CanonicalT5CoverageTimingSql("o.minutes_before_close) OR 1=1 --"),
    /N2_T5_MARKET_COVERAGE_TIMING_COLUMN_INVALID/u,
  );
});
