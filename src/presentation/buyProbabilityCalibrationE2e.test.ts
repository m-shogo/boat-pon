import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY probability calibration uses the effective probability that produced EV and exposes only aggregate pipeline stages", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-calibration-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-calibration-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const decision = db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?,?,?,?)`);
    const pipeline = db.prepare("UPDATE decision_history SET raw_estimated_hit_rate=?, conservative_hit_rate=? WHERE race_id=? AND run_kind='paper-live'");
    const result = db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");

    // Oldest settled BUY lacks enough stored decision data to reconstruct the effective probability.
    decision.run("paper-missing", "2026-07-01", "PRIVATE", 1, "trifecta", "1-2-3", null, null, 0, "v1", null, null, 40, 100, "paper-live", "2026-07-01T00:00:00Z");
    result.run("paper-missing", "1-3-2", 200, 0);

    // Pipeline for the 30 eligible BUYs:
    // raw 25% -> conservative 10% -> feature-adjusted 20% -> decision-effective 4%.
    // The BUY decision actually used 4% because stored EV 1.6 / decision odds 40 = 0.04.
    for (let i = 0; i < 30; i += 1) {
      const day = String(i + 2).padStart(2, "0");
      const raceId = `paper-${day}`;
      decision.run(raceId, `2026-07-${day}`, "PRIVATE", 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.2, 1.6, 40, 100, "paper-live", `2026-07-${day}T00:00:00Z`);
      pipeline.run(0.25, 0.1, raceId);
      result.run(raceId, i === 29 ? "1-2-3" : "1-3-2", 5000, 0);
    }

    // Must not contaminate Current BUY calibration or the pipeline.
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
    assert.equal(status.productionChangeAllowed, false);
    assert.match(status.probabilityBasis, /decision_effective/u);
    assert.equal(status.overall.status, "AVAILABLE");
    assert.equal(status.overall.settled, 31);
    assert.equal(status.overall.probabilityEligible, 30);
    assert.equal(status.overall.missingProbability, 1);
    assert.equal(status.overall.probabilityCoverage, 0.9677);
    assert.equal(status.overall.metrics.expectedHits, 1.2);
    assert.equal(status.overall.metrics.observedHits, 1);
    assert.equal(status.overall.metrics.averagePredictedHitRate, 0.04);
    assert.equal(status.overall.metrics.observedHitRate, 0.0333);
    assert.equal(status.overall.metrics.calibrationBias, 0.0067);
    assert.equal(status.overall.metrics.brierScore, 0.0323);
    assert.equal(status.overall.metrics.classification, "WITHIN_5PT");
    assert.equal(status.recent.status, "AVAILABLE");
    assert.equal(status.recent.settled, 30);
    assert.equal(status.recent.metrics.averagePredictedHitRate, 0.04);
    assert.equal(status.highEv.status, "AVAILABLE");
    assert.equal(status.highEv.settled, 30);
    assert.equal(status.highEv.metrics.classification, "WITHIN_5PT");

    assert.equal(status.preCalibration.overall.status, "AVAILABLE");
    assert.equal(status.preCalibration.overall.metrics.expectedHits, 6);
    assert.equal(status.preCalibration.overall.metrics.averagePredictedHitRate, 0.2);
    assert.equal(status.preCalibration.overall.metrics.calibrationBias, 0.1667);
    assert.equal(status.preCalibration.overall.metrics.brierScore, 0.06);
    assert.equal(status.preCalibration.overall.metrics.classification, "OVERCONFIDENT");

    const pipelineOverall = status.probabilityPipeline.overall;
    assert.equal(pipelineOverall.settled, 31);
    assert.equal(pipelineOverall.observedHits, 1);
    assert.equal(pipelineOverall.observedHitRate, 0.0323);
    assert.deepEqual(pipelineOverall.stages.rawModel, { eligible: 30, missing: 1, coverage: 0.9677, averageProbability: 0.25, expectedHits: 7.5 });
    assert.deepEqual(pipelineOverall.stages.conservativeModel, { eligible: 30, missing: 1, coverage: 0.9677, averageProbability: 0.1, expectedHits: 3 });
    assert.deepEqual(pipelineOverall.stages.featureAdjusted, { eligible: 30, missing: 1, coverage: 0.9677, averageProbability: 0.2, expectedHits: 6 });
    assert.deepEqual(pipelineOverall.stages.decisionEffective, { eligible: 30, missing: 1, coverage: 0.9677, averageProbability: 0.04, expectedHits: 1.2 });
    assert.deepEqual(pipelineOverall.transitions.rawToConservative, { paired: 30, fromAverage: 0.25, toAverage: 0.1, delta: -0.15, retentionRatio: 0.4 });
    assert.deepEqual(pipelineOverall.transitions.conservativeToFeatureAdjusted, { paired: 30, fromAverage: 0.1, toAverage: 0.2, delta: 0.1, retentionRatio: 2 });
    assert.deepEqual(pipelineOverall.transitions.featureAdjustedToDecisionEffective, { paired: 30, fromAverage: 0.2, toAverage: 0.04, delta: -0.16, retentionRatio: 0.2 });

    const reportText = await readFile(output, "utf8");
    assert.match(reportText, /buy-probability-calibration-public-v4/u);
    assert.doesNotMatch(reportText, /PRIVATE|PRIVATE_HISTORY|selection|raceId|decisionId|currentOdds|stake|venue/u);
  } finally {
    await rm(output, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test("BUY probability calibration fails closed on impossible pre-calibration model probabilities", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-calibration-invalid-model-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-calibration-invalid-model-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES ('bad','2026-07-01','PRIVATE',1,'trifecta','BUY','1-2-3',NULL,NULL,0,'v1',1.2,1.3,10,100,'paper-live','2026-07-01T00:00:00Z')`).run();
    db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES ('bad','1-3-2',200,0)").run();
  } finally {
    db.close();
  }
  try {
    await assert.rejects(
      execFileAsync("npx", ["tsx", "scripts/report-buy-probability-calibration.ts", "--run-kind", "paper-live", "--output", output], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath } }),
      /estimated_hit_rate outside \[0,1\]/u,
    );
  } finally {
    await rm(output, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test("BUY probability calibration fails closed when stored EV and decision odds imply an impossible effective probability", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-calibration-invalid-effective-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-calibration-invalid-effective-${process.pid}-${Date.now()}.json`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES ('bad-effective','2026-07-01','PRIVATE',1,'trifecta','BUY','1-2-3',NULL,NULL,0,'v1',0.2,12,10,100,'paper-live','2026-07-01T00:00:00Z')`).run();
    db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES ('bad-effective','1-3-2',200,0)").run();
  } finally {
    db.close();
  }
  try {
    await assert.rejects(
      execFileAsync("npx", ["tsx", "scripts/report-buy-probability-calibration.ts", "--run-kind", "paper-live", "--output", output], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath } }),
      /decision-effective hit rate outside \[0,1\]/u,
    );
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
