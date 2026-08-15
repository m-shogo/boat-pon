import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY pattern learning only promotes a private segment after two independent official-settlement windows", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-pattern-replication-"));
  const dbPath = join(temp, "boat.sqlite");
  const output = `data/tmp/buy-pattern-replication-${process.pid}-${Date.now()}.json`;
  const privateDir = `data/private/test-pattern-replication-${process.pid}-${Date.now()}`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    const decision = db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
      VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?,?,?,?)`);
    const result = db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");

    for (let i = 0; i < 120; i += 1) {
      const raceId = `paper-${String(i).padStart(3, "0")}`;
      const date = new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 12))).toISOString().slice(0, 10);
      const raceNo = (i % 12) + 1;
      const highEv = i % 2 === 0;
      const selection = "1-2-3";
      decision.run(
        raceId, date, "PRIVATE", raceNo, "trifecta", selection,
        null, null, 0, "v1", 0.1, highEv ? 1.3 : 0.9, 10, 100,
        "paper-live", `${date}T${String(raceNo).padStart(2, "0")}:00:00Z`,
      );
      result.run(raceId, highEv ? "1-3-2" : selection, 200, 0);
    }

    // A huge historical hit must not enter Current BUY replication windows.
    decision.run("history", "2025-01-01", "PRIVATE_HISTORY", 1, "trifecta", "1-2-3", "1-2-3", 999900, 0, "v0", 0.9, 9, 999, 999, "historical-backfill", "2025-01-01T00:00:00Z");
  } finally {
    db.close();
  }

  try {
    const { stdout } = await execFileAsync("npx", [
      "tsx", "scripts/analyze-buy-pattern-replication.ts",
      "--run-kind", "paper-live",
      "--window-size", "60",
      "--min-settled", "30",
      "--min-roi-delta", "0.15",
      "--output-public", output,
      "--retain-private-dir", privateDir,
    ], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath }, maxBuffer: 1024 * 1024 });

    const status = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(status.status, "REPLICATED_SIGNALS");
    assert.equal(status.totalSettled, 120);
    assert.equal(status.replicatedPatternCount, 2);
    assert.equal(status.publicSignalCount, 2);
    assert.equal(status.productionChangeAllowed, false);

    const report = JSON.parse(await readFile(output, "utf8")) as {
      signals: Array<{ direction: string; dimension: string; evidenceCount: number; roiDelta: number }>;
      missingSettledToCompare: number;
    };
    assert.equal(report.missingSettledToCompare, 0);
    assert.deepEqual(new Set(report.signals.map((signal) => signal.direction)), new Set(["SUCCESS_EDGE", "FAILURE_REGIME"]));
    assert.ok(report.signals.every((signal) => signal.dimension === "evBand"));
    assert.ok(report.signals.every((signal) => signal.evidenceCount === 60));
    assert.ok(report.signals.some((signal) => signal.roiDelta > 0));
    assert.ok(report.signals.some((signal) => signal.roiDelta < 0));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|PRIVATE_HISTORY|segmentKey|selection|raceId|decisionId|currentOdds|stake/u);
  } finally {
    await rm(output, { force: true });
    await rm(privateDir, { recursive: true, force: true });
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
