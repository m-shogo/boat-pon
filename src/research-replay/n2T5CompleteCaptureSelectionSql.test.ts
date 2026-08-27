import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { n2CanonicalT5CompleteCaptureSelectionHavingSql } from "./n2T5CompleteCaptureSelectionSql";

function canonicalSelections(): string[] {
  const rows: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        if (new Set([first, second, third]).size !== 3) continue;
        rows.push(`${first}-${second}-${third}`);
      }
    }
  }
  return rows;
}

function qualifies(values: readonly string[]): boolean {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE samples(selection TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO samples(selection) VALUES (?)");
  for (const value of values) insert.run(value);
  const havingSql = n2CanonicalT5CompleteCaptureSelectionHavingSql("selection");
  const row = db.prepare(`SELECT COUNT(*) AS n FROM samples HAVING ${havingSql}`).get();
  db.close();
  return row !== undefined;
}

test("canonical T-5 complete capture requires exactly all 120 canonical selections", () => {
  const valid = canonicalSelections();
  assert.equal(valid.length, 120);
  assert.equal(qualifies(valid), true);
  assert.equal(qualifies([...valid.slice(0, 119), "9-9-9"]), false);
  assert.equal(qualifies([...valid, valid[0]!]), false);
});

test("canonical T-5 complete capture SQL rejects unsafe column expressions", () => {
  assert.throws(
    () => n2CanonicalT5CompleteCaptureSelectionHavingSql("selection) OR 1=1 --"),
    /N2_T5_COLLECTOR_SELECTION_COLUMN_INVALID/u,
  );
});
