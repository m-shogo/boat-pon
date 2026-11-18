import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import test from "node:test";
import { hasBeforeInfoData } from "../../server/db";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE exhibition_data (race_id TEXT, course INTEGER, exhibition_time REAL, start_timing REAL, ranking INTEGER, fetched_at TEXT, source_type TEXT);
CREATE TABLE race_weather (race_id TEXT);
CREATE TABLE race_equipment (race_id TEXT);
INSERT INTO race_weather VALUES ('r1');
INSERT INTO race_equipment VALUES ('r1');
`);
  return db;
}

test("hasBeforeInfoData: スタート展示の ST だけの行では済みにしない（展示タイムを取り直す）", () => {
  const db = setup();
  for (let course = 1; course <= 6; course += 1) db.prepare("INSERT INTO exhibition_data VALUES ('r1', ?, NULL, 0.1, NULL, 'x', 'official_live')").run(course);
  assert.equal(hasBeforeInfoData(db, "r1"), false);
});

test("hasBeforeInfoData: 展示タイムが入っていれば済み", () => {
  const db = setup();
  for (let course = 1; course <= 6; course += 1) db.prepare("INSERT INTO exhibition_data VALUES ('r1', ?, 6.8, 0.1, NULL, 'x', 'official_live')").run(course);
  assert.equal(hasBeforeInfoData(db, "r1"), true);
});

test("hasBeforeInfoData: 行が無ければ済みにしない", () => {
  assert.equal(hasBeforeInfoData(setup(), "r1"), false);
});
