import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY outcome pattern report reconciles paper-live to official race_results and keeps exact segment keys private", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-pattern-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-pattern-e2e-${suffix}.json`;
  const privateDir = `data/private/buy-pattern-e2e-${suffix}`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const insertDecision = decisionInsert(db);
    const insertResult = resultInsert(db);

    for (let i = 0; i < 30; i += 1) {
      const successRace = `success-${i}`;
      const failureRace = `failure-${i}`;
      // decision_history settlement remains null; official race_results is authoritative for paper-live.
      insertDecision.run(successRace, "2026-08-15", "VENUE_SUCCESS_PRIVATE", i + 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.4, 1.1, 0.5, 100, "paper-live", "2026-08-15T00:00:00Z");
      insertResult.run(successRace, "1-2-3", 200, 0);
      insertDecision.run(failureRace, "2026-08-15", "VENUE_FAILURE_PRIVATE", i + 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.4, 1.1, 0.5, 100, "paper-live", "2026-08-15T00:00:00Z");
      insertResult.run(failureRace, "1-3-2", 200, 0);

      // Huge historical hits must not affect the Current BUY baseline or signals.
      insertDecision.run(`history-${i}`, "2025-01-01", "VENUE_HISTORY_PRIVATE", i + 1, "trifecta", "1-2-3", "1-2-3", 10000, 0, "v0", 0.9, 90.0, 100.0, 500, "historical-backfill", "2025-01-01T00:00:00Z");
    }

    // Same issued BUY observed twice: only the latest decision row may count.
    insertDecision.run("success-0", "2026-08-15", "VENUE_SUCCESS_PRIVATE", 1, "trifecta", "1-2-3", null, null, 0, "v1", 0.4, 1.1, 0.5, 100, "paper-live", "2026-08-15T01:00:00Z");

    // Returned races are not economically settled evidence.
    insertDecision.run("returned-1", "2026-08-15", "VENUE_RETURNED_PRIVATE", 12, "trifecta", "1-2-3", null, null, 0, "v1", 0.4, 1.1, 0.5, 100, "paper-live", "2026-08-15T00:00:00Z");
    insertResult.run("returned-1", null, null, 1);
  } finally {
    db.close();
  }

  try {
    const { stdout } = await execFileAsync("npx", [
      "tsx", "scripts/analyze-buy-outcome-patterns.ts",
      "--run-kind", "paper-live",
      "--min-settled", "30",
      "--min-roi-delta", "0.15",
      "--output-public", output,
      "--retain-private-dir", privateDir,
    ], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath }, maxBuffer: 1024 * 1024 });

    const status = JSON.parse(stdout.trim()) as {
      analyzedSettled: number;
      supportStatus: string;
      globalAdditionalSettledForAnyContrast: number;
      supportedContrastCount: number;
      supportedDimensionCount: number;
      noSignalReason: string | null;
      privatePatternCount: number;
      publicSignalCount: number;
      retained: boolean;
      productionChangeAllowed: boolean;
    };
    assert.equal(status.analyzedSettled, 60);
    assert.equal(status.supportStatus, "SUPPORTED_CONTRASTS");
    assert.equal(status.globalAdditionalSettledForAnyContrast, 0);
    assert.equal(status.supportedContrastCount, 2);
    assert.equal(status.supportedDimensionCount, 1);
    assert.equal(status.noSignalReason, null);
    assert.equal(status.privatePatternCount, 2);
    assert.equal(status.publicSignalCount, 2);
    assert.equal(status.retained, true);
    assert.equal(status.productionChangeAllowed, false);

    const publicRecord = JSON.parse(await readFile(output, "utf8")) as {
      analyzedSettled: number;
      support: {
        status: string;
        minimumSettledPerSide: number;
        minimumTotalSettledForAnyContrast: number;
        globalAdditionalSettledForAnyContrast: number;
        supportedContrastCount: number;
        supportedDimensionCount: number;
      };
      noSignalReason: string | null;
      signals: Array<{ direction: string; dimension: string; roiDelta: number; productionChangeAllowed: boolean }>;
    };
    assert.equal(publicRecord.analyzedSettled, 60);
    assert.deepEqual(publicRecord.support, {
      status: "SUPPORTED_CONTRASTS",
      baselineSettled: 60,
      minimumSettledPerSide: 30,
      minimumTotalSettledForAnyContrast: 60,
      globalAdditionalSettledForAnyContrast: 0,
      validSegmentCount: 8,
      segmentSideEligibleCount: 7,
      supportedContrastCount: 2,
      supportedDimensionCount: 1,
    });
    assert.equal(publicRecord.noSignalReason, null);
    assert.deepEqual(new Set(publicRecord.signals.map((signal) => signal.direction)), new Set(["SUCCESS_EDGE", "FAILURE_REGIME"]));
    assert.ok(publicRecord.signals.every((signal) => signal.dimension === "venue"));
    // Each 30-race venue is compared with the other 30-race venue: ROI 2.0 vs 0.0.
    assert.ok(publicRecord.signals.every((signal) => Math.abs(signal.roiDelta) === 2));
    assert.ok(publicRecord.signals.every((signal) => signal.productionChangeAllowed === false));

    const publicText = JSON.stringify(publicRecord);
    assert.doesNotMatch(publicText, /VENUE_SUCCESS_PRIVATE|VENUE_FAILURE_PRIVATE|VENUE_HISTORY_PRIVATE|VENUE_RETURNED_PRIVATE/);
    assert.doesNotMatch(publicText, /segmentKey|selection|currentOdds|requiredOdds|stake|comparisonSettled|comparisonRoiProxy/);

    const privateFiles = await readdir(privateDir);
    assert.equal(privateFiles.length, 1);
    const privateText = await readFile(join(privateDir, privateFiles[0]!), "utf8");
    assert.match(privateText, /VENUE_SUCCESS_PRIVATE/);
    assert.match(privateText, /VENUE_FAILURE_PRIVATE/);
    assert.match(privateText, /"comparisonSettled": 30/);
    assert.doesNotMatch(privateText, /VENUE_HISTORY_PRIVATE|VENUE_RETURNED_PRIVATE/);
  } finally {
    await rm(output, { force: true });
    await rm(privateDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test("paper-live pattern mining fails closed when decision result conflicts with official race_results", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-pattern-mismatch-"));
  const dbPath = join(temp, "boat.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    decisionInsert(db).run("mismatch-1", "2026-08-15", "PRIVATE", 1, "trifecta", "1-2-3", "1-2-3", 300, 0, "v1", 0.4, 1.1, 2.9, 100, "paper-live", "2026-08-15T00:00:00Z");
    resultInsert(db).run("mismatch-1", "1-3-2", 300, 0);
  } finally {
    db.close();
  }

  try {
    await assert.rejects(
      execFileAsync("npx", ["tsx", "scripts/analyze-buy-outcome-patterns.ts", "--run-kind", "paper-live"], {
        env: { ...process.env, BOAT_PON_DB_PATH: dbPath },
        maxBuffer: 1024 * 1024,
      }),
      (error: unknown) => String((error as { stderr?: string }).stderr ?? error).includes("paper-live settlement result conflicts with official race_results"),
    );
  } finally {
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
