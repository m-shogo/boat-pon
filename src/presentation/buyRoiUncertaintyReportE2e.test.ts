import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY ROI uncertainty uses official paper-live payouts and exposes heavy-tail uncertainty safely", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-roi-bootstrap-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-roi-bootstrap-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const insertDecision = decisionInsert(db);
    const insertResult = resultInsert(db);
    for (let i = 0; i < 30; i += 1) {
      const raceId = `paper-${i}`;
      insertDecision.run(raceId, "2026-08-15", "PRIVATE", i + 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.4, 1.2, 10, 100, "paper-live", `2026-08-15T00:${String(i).padStart(2, "0")}:00Z`);
      insertResult.run(raceId, i === 0 ? "1-2-3" : "1-3-2", 6000, 0);
    }
    // Historical payout must not enter Current BUY uncertainty.
    insertDecision.run("history-1", "2025-01-01", "PRIVATE_HISTORY", 1, "trifecta", "1-2-3", "1-2-3", 100000, 0, "v0", 0.9, 10, 1000, 500, "historical-backfill", "2025-01-01T00:00:00Z");
  } finally {
    db.close();
  }

  try {
    const { stdout } = await execFileAsync("npx", [
      "tsx", "scripts/report-buy-roi-uncertainty.ts",
      "--run-kind", "paper-live",
      "--recent", "30",
      "--minimum-trials", "30",
      "--iterations", "2000",
      "--output", output,
    ], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath }, maxBuffer: 1024 * 1024 });

    const status = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(status.status, "AVAILABLE");
    assert.equal(status.productionChangeAllowed, false);

    const report = JSON.parse(await readFile(output, "utf8")) as {
      performance: { interval: { trials: number; pointEstimate: number; lower: number; upper: number; classification: string } };
      recent: { interval: { trials: number; pointEstimate: number; lower: number; upper: number; classification: string } };
    };
    assert.equal(report.performance.interval.trials, 30);
    assert.equal(report.performance.interval.pointEstimate, 2);
    assert.equal(report.performance.interval.lower, 0);
    assert.ok(report.performance.interval.upper > 1);
    assert.equal(report.performance.interval.classification, "CROSSES_BREAK_EVEN");
    assert.deepEqual(report.recent.interval, report.performance.interval);

    const publicText = JSON.stringify(report);
    assert.doesNotMatch(publicText, /PRIVATE|PRIVATE_HISTORY|selection|raceId|decisionId|segmentKey|currentOdds|stake/u);
  } finally {
    await rm(output, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

function createTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE decision_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      selection TEXT NOT NULL,
      result TEXT,
      payout_yen INTEGER,
      returned INTEGER NOT NULL DEFAULT 0,
      model_version TEXT,
      estimated_hit_rate REAL,
      ev REAL,
      current_odds REAL,
      sample_size INTEGER,
      run_kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE race_results (
      race_id TEXT PRIMARY KEY,
      trifecta TEXT,
      payout_yen INTEGER,
      returned INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function decisionInsert(db: DatabaseSync) {
  return db.prepare(`INSERT INTO decision_history
    (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
    VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?,?,?,?)`);
}

function resultInsert(db: DatabaseSync) {
  return db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");
}
