/**
 * Research-only synthetic denominator regression. No production DB, odds, or live report imports.
 * This documents the CURRENT (not endorsed) selection differences between the two reports.
 * See issue #2289. A scoring policy change requires a separate decision and review.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { binaryMetrics } from "../domain/accuracyScorecard";

type Decision = { race_id: string; selection: string; estimated_hit_rate: number; hit: 0 | 1 };
const score = (rows: Decision[]) => binaryMetrics(rows.map((r) => ({ p: r.estimated_hit_rate, hit: r.hit })));

test("research-only: scorecard all paper-live rows versus growth latest current-model row", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE decision_history (
      id INTEGER PRIMARY KEY, race_id TEXT NOT NULL, bet_type TEXT NOT NULL,
      selection TEXT NOT NULL, run_kind TEXT NOT NULL, model_version TEXT NOT NULL,
      date TEXT NOT NULL, created_at TEXT NOT NULL, estimated_hit_rate REAL NOT NULL,
      hit INTEGER NOT NULL
    )`);
    const insert = db.prepare(`INSERT INTO decision_history
      (id, race_id, bet_type, selection, run_kind, model_version, date, created_at, estimated_hit_rate, hit)
      VALUES (?, ?, 'trifecta', ?, 'paper-live', ?, '2026-11-01', ?, ?, ?)`);
    insert.run(1, "r1", "1-2-3", "current", "2026-11-01T10:00:00Z", 0.8, 1);
    insert.run(2, "r1", "1-2-3", "current", "2026-11-01T10:01:00Z", 0.2, 1);
    insert.run(3, "r2", "2-1-3", "current", "2026-11-01T10:00:00Z", 0.7, 1);
    insert.run(4, "r3", "3-1-2", "legacy", "2026-11-01T10:00:00Z", 0.9, 0);
    insert.run(5, "r4", "4-1-2", "current", "2026-11-01T10:00:00Z", 0.3, 0);

    // Current scorecard population: all paper-live decisions in the window.
    const all = db.prepare(`SELECT race_id, selection, estimated_hit_rate, hit
      FROM decision_history WHERE run_kind = 'paper-live' AND date BETWEEN ? AND ?`)
      .all("2026-11-01", "2026-11-01") as Decision[];
    // Current growth population: current model only, latest per race/type/selection.
    const latest = db.prepare(`WITH d AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY race_id, bet_type, selection ORDER BY created_at DESC, id DESC
      ) AS row_num FROM decision_history
      WHERE run_kind = 'paper-live' AND model_version = ? AND date BETWEEN ? AND ?
    ) SELECT race_id, selection, estimated_hit_rate, hit FROM d WHERE row_num = 1`)
      .all("current", "2026-11-01", "2026-11-01") as Decision[];

    assert.equal(all.length, 5);
    assert.equal(latest.length, 3);
    assert.deepEqual(latest.map((r) => [r.race_id, r.estimated_hit_rate]), [
      ["r1", 0.2], ["r2", 0.7], ["r4", 0.3],
    ]);
    const a = score(all);
    const b = score(latest);
    assert.ok(Math.abs((a.logLoss ?? 0) - 0.969703) < 1e-6);
    assert.ok(Math.abs((a.brier ?? 0) - 0.334) < 1e-12);
    assert.ok(Math.abs((b.logLoss ?? 0) - 0.774263) < 1e-6);
    assert.ok(Math.abs((b.brier ?? 0) - 0.2733333333333333) < 1e-12);
    // Differences are denominator sensitivity only, not measured real-world improvement.
    assert.notEqual(a.logLoss, b.logLoss);
  } finally {
    db.close();
  }
});

test("research-only: equal timestamps resolve by descending id, not insertion order", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE decisions (id INTEGER PRIMARY KEY, race_id TEXT, created_at TEXT, probability REAL)");
    const insert = db.prepare("INSERT INTO decisions VALUES (?, ?, ?, ?)");
    // Insert in reverse id order so physical row order cannot determine the winner.
    insert.run(20, "tie-race", "2026-11-01T10:00:00Z", 0.25);
    insert.run(10, "tie-race", "2026-11-01T10:00:00Z", 0.75);
    const rows = db.prepare(`SELECT id, probability FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY race_id ORDER BY created_at DESC, id DESC
      ) AS row_num FROM decisions
    ) WHERE row_num = 1`).all() as Array<{ id: number; probability: number }>;
    assert.deepEqual(rows, [{ id: 20, probability: 0.25 }]);
  } finally {
    db.close();
  }
});
