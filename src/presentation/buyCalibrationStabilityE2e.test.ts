import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY probability report classifies matching conclusions in two independent official-settlement windows", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-calibration-stability-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/calibration-stability-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const decision = db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?,?,?,?)`);
    const result = db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");
    for (let i = 0; i < 60; i += 1) {
      const raceId = `paper-${String(i).padStart(3, "0")}`;
      const date = new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10);
      const hit = i === 10 || i === 40;
      decision.run(raceId, date, "PRIVATE", 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.06, 1.3, 22, 100, "paper-live", `${date}T00:00:00Z`);
      result.run(raceId, hit ? "1-2-3" : "1-3-2", 4000, 0);
    }
    decision.run("history", "2025-01-01", "PRIVATE_HISTORY", 1, "trifecta", "1-2-3", "1-2-3", 999900, 0, "v0", 0.99, 9, 999, 999, "historical-backfill", "2025-01-01T00:00:00Z");
  } finally {
    db.close();
  }
  try {
    const { stdout } = await execFileAsync("npx", [
      "tsx", "scripts/report-buy-probability-calibration.ts",
      "--run-kind", "paper-live",
      "--recent", "30",
      "--minimum-trials", "30",
      "--high-ev-threshold", "1.2",
      "--output", output,
    ], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath }, maxBuffer: 1024 * 1024 });
    const status = JSON.parse(stdout.trim()) as any;
    assert.equal(status.stability.status, "STABLE_WITHIN_5PT");
    assert.equal(status.stability.totalSettled, 60);
    assert.equal(status.stability.requiredSettled, 60);
    assert.equal(status.stability.missingSettledToCompare, 0);
    assert.equal(status.stability.recent.probabilityEligible, 30);
    assert.equal(status.stability.prior.probabilityEligible, 30);
    assert.equal(status.stability.recent.metrics.classification, "WITHIN_5PT");
    assert.equal(status.stability.prior.metrics.classification, "WITHIN_5PT");
    assert.equal(status.productionChangeAllowed, false);
    const report = JSON.parse(await readFile(output, "utf8")) as any;
    assert.equal(report.schemaVersion, "buy-probability-calibration-public-v4");
    assert.match(report.probabilityBasis, /decision_effective/u);
    assert.equal(report.prior.status, "AVAILABLE");
    assert.equal(report.stability.status, "STABLE_WITHIN_5PT");
    assert.equal(report.probabilityPipeline.overall.settled, 60);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|PRIVATE_HISTORY|selection|raceId|decisionId|currentOdds|stake|venue/u);
  } finally {
    await rm(output, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test("BUY probability report keeps calibration stability unavailable when one window lacks decision-effective probability support", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-calibration-stability-missing-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/calibration-stability-missing-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const decision = db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?,?,?,?)`);
    const result = db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");
    for (let i = 0; i < 60; i += 1) {
      const raceId = `paper-${String(i).padStart(3, "0")}`;
      const date = new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10);
      decision.run(raceId, date, "PRIVATE", 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.06, i === 59 ? null : 1.3, 22, 100, "paper-live", `${date}T00:00:00Z`);
      result.run(raceId, i === 10 || i === 40 ? "1-2-3" : "1-3-2", 4000, 0);
    }
  } finally { db.close(); }
  try {
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/report-buy-probability-calibration.ts", "--run-kind", "paper-live", "--recent", "30", "--minimum-trials", "30", "--output", output], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath } });
    const status = JSON.parse(stdout.trim()) as any;
    assert.equal(status.stability.status, "INSUFFICIENT_SUPPORT");
    assert.ok(status.stability.recent.probabilityEligible === 29 || status.stability.prior.probabilityEligible === 29);
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
      raw_estimated_hit_rate REAL,
      conservative_hit_rate REAL,
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
