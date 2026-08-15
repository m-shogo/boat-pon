import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY tail report waits at 58 settled then compares two non-overlapping 30-BUY windows at 60", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-tail-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-tail-e2e-${suffix}.json`;
  const privateDir = `data/private/buy-tail-e2e-${suffix}`;
  const db = new DatabaseSync(dbPath);
  try {
    createTables(db);
    for (let raceNo = 1; raceNo <= 58; raceNo += 1) insertOutcome(db, raceNo, raceNo === 28 || raceNo === 58);
  } finally {
    db.close();
  }

  const run = async () => execFileAsync("npx", [
    "tsx", "scripts/analyze-buy-tail-dependence.ts",
    "--run-kind", "paper-live",
    "--window-size", "30",
    "--min-tail-gap", "0.15",
    "--output-public", output,
    "--retain-private-dir", privateDir,
  ], { env: { ...process.env, BOAT_PON_DB_PATH: dbPath }, maxBuffer: 1024 * 1024 });

  try {
    const first = await run();
    const firstStatus = JSON.parse(first.stdout.trim()) as {
      status: string;
      totalSettled: number;
      recentSettled: number;
      priorSettled: number;
      missingSettledToCompare: number;
      retained: boolean;
    };
    assert.equal(firstStatus.status, "INSUFFICIENT_SUPPORT");
    assert.equal(firstStatus.totalSettled, 58);
    assert.equal(firstStatus.recentSettled, 30);
    assert.equal(firstStatus.priorSettled, 28);
    assert.equal(firstStatus.missingSettledToCompare, 2);
    assert.equal(firstStatus.retained, true);

    const db2 = new DatabaseSync(dbPath);
    try {
      insertOutcome(db2, 59, false);
      insertOutcome(db2, 60, false);
    } finally {
      db2.close();
    }

    const second = await run();
    const secondStatus = JSON.parse(second.stdout.trim()) as {
      status: string;
      totalSettled: number;
      recentSettled: number;
      priorSettled: number;
      missingSettledToCompare: number;
      retained: boolean;
      productionChangeAllowed: boolean;
    };
    assert.equal(secondStatus.status, "PERSISTENT_TAIL_DEPENDENCE");
    assert.equal(secondStatus.totalSettled, 60);
    assert.equal(secondStatus.recentSettled, 30);
    assert.equal(secondStatus.priorSettled, 30);
    assert.equal(secondStatus.missingSettledToCompare, 0);
    assert.equal(secondStatus.retained, true);
    assert.equal(secondStatus.productionChangeAllowed, false);

    const publicRecord = JSON.parse(await readFile(output, "utf8")) as {
      status: string;
      support: { recentSettled: number; priorSettled: number; missingSettledToCompare: number };
      recent: { tailDependent: boolean; tailGap: number };
      prior: { tailDependent: boolean; tailGap: number };
      productionChangeAllowed: boolean;
    };
    assert.equal(publicRecord.status, "PERSISTENT_TAIL_DEPENDENCE");
    assert.equal(publicRecord.recent.tailDependent, true);
    assert.equal(publicRecord.prior.tailDependent, true);
    assert.ok(publicRecord.recent.tailGap >= 0.15);
    assert.ok(publicRecord.prior.tailGap >= 0.15);
    assert.equal(publicRecord.productionChangeAllowed, false);
    const publicText = JSON.stringify(publicRecord);
    assert.doesNotMatch(publicText, /selection|raceId|decisionId|currentOdds|requiredOdds|recommendedAmount|stake|segmentKey|1-2-3/);
    assert.equal((await readdir(privateDir)).length, 2);
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

function insertOutcome(db: DatabaseSync, raceNo: number, hit: boolean) {
  db.prepare(`INSERT INTO decision_history
    (race_id,date,venue,race_no,bet_type,decision,selection,result,payout_yen,returned,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind,created_at)
    VALUES (?,?,?,?,?,'BUY',?,NULL,NULL,0,'v1',0.2,1.2,10,100,'paper-live',?)`)
    .run(`tail-${raceNo}`, "2026-08-15", "PRIVATE", raceNo, "trifecta", "1-2-3", `2026-08-15T00:${String(raceNo % 60).padStart(2, "0")}:00Z`);
  db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,0)")
    .run(`tail-${raceNo}`, hit ? "1-2-3" : "1-3-2", hit ? 6000 : 300);
}
