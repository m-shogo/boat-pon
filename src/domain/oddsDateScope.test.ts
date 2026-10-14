import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { listAllOddsBySelection, listEarlyOddsSnapshots, listLatestOddsSnapshotsForDate, listOddsSnapshots } from "../../server/db";

// auto-odds は判定の前に当日のレースのオッズだけを読む（2026-10-14: 全期間の読み込みに約40秒かかっていた）。
// 当日分の結果が、全期間の結果を当日のレースに絞ったものと一致することを確かめる。
function oddsDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE odds_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, race_id TEXT NOT NULL, selection TEXT NOT NULL, odds REAL NOT NULL,
    popularity INTEGER, source TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_final_like INTEGER NOT NULL DEFAULT 0)`);
  const insert = db.prepare("INSERT INTO odds_snapshots (race_id, selection, odds, source, captured_at) VALUES (?, ?, ?, ?, ?)");
  insert.run("20261013-丸亀-12", "1-2-3", 5.0, "official", "2026-10-13T11:00:00Z");
  insert.run("20261014-丸亀-04", "1-2-3", 80.0, "official-early", "2026-10-14T06:00:00Z");
  insert.run("20261014-丸亀-04", "1-2-3", 75.0, "official", "2026-10-14T07:30:00Z");
  insert.run("20261014-丸亀-04", "1-3-2", 40.0, "official", "2026-10-14T07:30:00Z");
  insert.run("20261014-住之江-12", "1-2-3", 9.9, "official", "2026-10-14T12:00:00Z");
  insert.run("20261015-桐生-01", "1-2-3", 7.0, "official-early", "2026-10-15T00:00:00Z");
  return db;
}

const onDay = (key: string) => key.startsWith("20261014-");

test("当日分のオッズは、全期間のオッズを当日のレースに絞ったものと一致する", () => {
  const db = oddsDb();
  const all = listAllOddsBySelection(db);
  const day = listAllOddsBySelection(db, "2026-10-14");
  assert.deepEqual([...day].sort(), [...all].filter(([k]) => onDay(k)).sort());
  assert.equal(day.get("20261014-丸亀-04/1-2-3"), 75);
  assert.equal(day.size, 3);

  const early = listEarlyOddsSnapshots(db);
  const earlyDay = listEarlyOddsSnapshots(db, "2026-10-14");
  assert.deepEqual([...earlyDay].sort(), [...early].filter(([k]) => onDay(k)).sort());
  assert.equal(earlyDay.size, 1);

  const latest = listOddsSnapshots(db).filter((s) => onDay(s.raceId));
  assert.deepEqual(listLatestOddsSnapshotsForDate(db, "2026-10-14"), latest);
});
