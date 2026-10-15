import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureFavoritePicks, loadFavoriteLedgers } from "../../scripts/lib/favoriteLedger";

function oddsDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE odds_timeseries_snapshots (id INTEGER PRIMARY KEY, race_id TEXT, selection TEXT, odds REAL, popularity INTEGER, source TEXT,
    captured_at TEXT, minutes_before_close INTEGER, checkpoint_label TEXT, created_at TEXT);
    CREATE TABLE race_results (race_id TEXT, date TEXT, trifecta TEXT, payout_yen INTEGER, returned INTEGER);`);
  const insert = db.prepare("INSERT INTO odds_timeseries_snapshots (race_id, selection, odds, source, captured_at, minutes_before_close, checkpoint_label) VALUES (?, ?, ?, 'official', ?, 5, 'T-5')");
  let i = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    if (a === b || a === c || b === c) continue;
    insert.run("20260701-芦屋-01", `${a}-${b}-${c}`, a === 1 && b === 2 && c === 3 ? 4.5 : 50 + i++, "2026-07-01T01:00:00Z");
  }
  db.prepare("INSERT INTO race_results VALUES ('20260701-芦屋-01', '2026-07-01', '1-2-3', 480, 0)").run();
  return db;
}

test("本命予想の日ごとの記録は一度だけ作り、既にあるファイルは書き換えない", () => {
  const db = oddsDb();
  const stateDir = mkdtempSync(join(tmpdir(), "fav-"));
  const now = new Date("2026-07-02T12:00:00Z");
  assert.equal(ensureFavoritePicks(db, "2026-07-01", stateDir, now), 1);
  const path = join(stateDir, "favorite-picks", "2026-07-01.json");
  const first = readFileSync(path, "utf8");
  assert.equal(JSON.parse(first).picks[0].selection, "1-2-3");
  assert.equal(JSON.parse(first).kind, "reconstructed");
  // 2回目は作らない。中身も変わらない。一時ファイルも残らない
  assert.equal(ensureFavoritePicks(db, "2026-07-01", stateDir, now), 0);
  assert.equal(readFileSync(path, "utf8"), first);
  assert.deepEqual(readdirSync(join(stateDir, "favorite-picks")), ["2026-07-01.json"]);
  // 公式の結果で精算する
  const ledgers = loadFavoriteLedgers(db, "2026-07-01", stateDir);
  assert.equal(ledgers.total.hits, 1);
  assert.equal(Math.round((ledgers.total.officialRoi ?? 0) * 100), 480);
});

test("別の実行が先に置いたファイルは上書きしない", () => {
  const db = oddsDb();
  const stateDir = mkdtempSync(join(tmpdir(), "fav-"));
  mkdirSync(join(stateDir, "favorite-picks"), { recursive: true });
  const path = join(stateDir, "favorite-picks", "2026-07-01.json");
  writeFileSync(path, '{"date":"2026-07-01","picks":[]}\n');
  assert.equal(ensureFavoritePicks(db, "2026-07-01", stateDir, new Date("2026-07-02T12:00:00Z")), 0);
  assert.equal(readFileSync(path, "utf8"), '{"date":"2026-07-01","picks":[]}\n');
});
