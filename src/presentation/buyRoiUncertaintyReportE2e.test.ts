import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY ROI uncertainty compares realized ROI with stored EV while hiding price realization below five hits", async () => {
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
    // Historical payout/EV/price must not enter Current BUY diagnostics.
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

    const status = JSON.parse(stdout.trim()) as any;
    assert.equal(status.status, "AVAILABLE");
    assert.equal(status.productionChangeAllowed, false);

    const report = JSON.parse(await readFile(output, "utf8")) as any;
    assert.equal(report.performance.interval.trials, 30);
    assert.equal(report.performance.interval.pointEstimate, 2);
    assert.equal(report.performance.interval.lower, 0);
    assert.ok(report.performance.interval.upper > 1.2);
    assert.equal(report.performance.interval.classification, "CROSSES_BREAK_EVEN");
    assert.deepEqual(report.recent.interval, report.performance.interval);

    assert.deepEqual(report.expectationRealization.performance, {
      status: "AVAILABLE",
      trials: 30,
      expectedEvEligible: 30,
      missingExpectedEv: 0,
      minimumTrials: 30,
      averageStoredEv: 1.2,
      realizedRoi: 2,
      realizedToExpectedRatio: 1.6667,
      classification: "CROSSES_EXPECTED",
    });
    assert.deepEqual(report.expectationRealization.recent, report.expectationRealization.performance);

    assert.deepEqual(report.priceRealization.performance, {
      status: "INSUFFICIENT_HIT_SUPPORT",
      hits: 1,
      priceEligibleHits: 1,
      minimumHits: 5,
      missingHits: 4,
      averageDecisionPriceProxy: null,
      averageRealizedPriceProxy: null,
      realizedToDecisionRatio: null,
      averagePriceGap: null,
    });
    assert.deepEqual(report.priceRealization.recent, report.priceRealization.performance);

    const publicText = JSON.stringify(report);
    assert.doesNotMatch(publicText, /PRIVATE|PRIVATE_HISTORY|selection|raceId|decisionId|segmentKey|currentOdds|stake/u);
  } finally {
    await rm(output, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test("BUY price realization only exposes aggregate proxies after five eligible hit outcomes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-price-realization-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-price-realization-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const insertDecision = decisionInsert(db);
    const insertResult = resultInsert(db);
    for (let i = 0; i < 30; i += 1) {
      const raceId = `paper-price-${i}`;
      const hit = i < 5;
      insertDecision.run(raceId, "2026-08-15", "PRIVATE", i + 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.1, 1.2, 12, 100, "paper-live", `2026-08-15T01:${String(i).padStart(2, "0")}:00Z`);
      insertResult.run(raceId, hit ? "1-2-3" : "1-3-2", 1800, 0);
    }
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
    const status = JSON.parse(stdout.trim()) as any;
    assert.equal(status.priceRealization.performance.status, "AVAILABLE");
    assert.equal(status.priceRealization.performance.hits, 5);
    assert.equal(status.priceRealization.performance.priceEligibleHits, 5);
    assert.equal(status.priceRealization.performance.minimumHits, 5);
    assert.equal(status.priceRealization.performance.missingHits, 0);
    assert.equal(status.priceRealization.performance.averageDecisionPriceProxy, 12);
    assert.equal(status.priceRealization.performance.averageRealizedPriceProxy, 18);
    assert.equal(status.priceRealization.performance.realizedToDecisionRatio, 1.5);
    assert.equal(status.priceRealization.performance.averagePriceGap, 6);
    assert.deepEqual(status.priceRealization.recent, status.priceRealization.performance);

    const reportText = await readFile(output, "utf8");
    assert.doesNotMatch(reportText, /PRIVATE|selection|raceId|decisionId|segmentKey|currentOdds|stake/u);
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
