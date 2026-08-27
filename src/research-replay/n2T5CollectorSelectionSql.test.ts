import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { n2CanonicalT5SelectionSql } from "./n2T5CollectorSelectionSql";

test("T-5 collector selection SQL accepts canonical ordered trifecta only", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE selections(value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO selections(value) VALUES (?)");
  for (const value of ["1-2-3", "6-5-4", "1-1-2", "9-2-3", "01-2-3", "1-2-3x"]) insert.run(value);
  const predicate = n2CanonicalT5SelectionSql("value");
  const rows = db.prepare(`SELECT value FROM selections WHERE ${predicate} ORDER BY value`).all() as Array<{ value: string }>;
  db.close();
  assert.deepEqual(rows.map((row) => row.value), ["1-2-3", "6-5-4"]);
});

test("T-5 full-market counting rejects a capture containing malformed selections", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE selections(value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO selections(value) VALUES (?)");
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        if (first === second || first === third || second === third) continue;
        insert.run(`${first}-${second}-${third}`);
      }
    }
  }
  const predicate = n2CanonicalT5SelectionSql("value");
  const count = () => db.prepare(`
    SELECT CASE WHEN selections = canonical_selections THEN canonical_selections ELSE 0 END AS n
    FROM (
      SELECT
        COUNT(DISTINCT value) AS selections,
        COUNT(DISTINCT CASE WHEN ${predicate} THEN value END) AS canonical_selections
      FROM selections
    )
  `).get() as { n: number };
  assert.equal(count().n, 120);
  insert.run("9-9-9");
  assert.equal(count().n, 0);
  db.close();
});

test("T-5 collector selection SQL only accepts safe internal column identifiers", () => {
  assert.doesNotThrow(() => n2CanonicalT5SelectionSql("o.selection"));
  assert.throws(() => n2CanonicalT5SelectionSql("o.selection) OR 1=1 --"), /N2_T5_COLLECTOR_SELECTION_COLUMN_INVALID/u);
});
