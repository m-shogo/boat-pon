import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("BUY learning report derives paper-live outcomes from official race_results and retains semantic evidence idempotently", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-learning-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-learning-e2e-${suffix}.json`;
  const privateDir = `data/private/buy-learning-e2e-${suffix}`;
  const db = new DatabaseSync(dbPath);
  try {
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
        returned INTEGER NOT NULL DEFAULT 0,
        current_odds REAL,
        payout_yen INTEGER,
        estimated_hit_rate REAL,
        sample_size INTEGER,
        ev REAL,
        model_version TEXT,
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
    const insert = db.prepare(`INSERT INTO decision_history
      (race_id,date,venue,race_no,bet_type,decision,selection,result,returned,current_odds,payout_yen,estimated_hit_rate,sample_size,ev,model_version,run_kind,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const result = db.prepare("INSERT INTO race_results (race_id,trifecta,payout_yen,returned) VALUES (?,?,?,?)");

    // decision_history settlement is deliberately null. Official race_results must drive economics.
    insert.run("r1", "2026-08-01", "A", 1, "trifecta", "BUY", "1-2-3", null, 0, 2.4, null, 0.60, 80, 1.44, "v1", "paper-live", "2026-08-01T00:00:00Z");
    result.run("r1", "1-2-3", 360, 0);
    insert.run("r2", "2026-08-02", "A", 2, "trifecta", "BUY", "1-2-3", null, 0, 4.2, null, 0.55, 20, 2.31, "v1", "paper-live", "2026-08-02T00:00:00Z");
    result.run("r2", "1-3-2", 420, 0);
    insert.run("r3", "2026-08-03", "B", 3, "trifecta", "BUY", "2-1-3", null, 0, 3.0, null, 0.30, 100, 0.90, "v1", "paper-live", "2026-08-03T00:00:00Z");
    result.run("r3", "3-1-2", 300, 0);
    insert.run("r4", "2026-08-04", "B", 4, "trifecta", "WATCH", "1-2-3", null, 0, 2.0, null, 0.50, 100, 1.00, "v1", "paper-live", "2026-08-04T00:00:00Z");

    // A huge historical hit must not contaminate Current BUY learning.
    insert.run("history", "2026-07-31", "A", 5, "trifecta", "BUY", "1-2-3", "1-2-3", 0, 99.0, 9900, 0.90, 500, 89.10, "v0", "historical-backfill", "2026-07-31T00:00:00Z");
  } finally {
    db.close();
  }

  try {
    const run = async () => execFileAsync("npx", ["tsx", "scripts/report-buy-learning-summary.ts", "--run-kind", "paper-live", "--recent", "30", "--output", output, "--retain-private-dir", privateDir], {
      env: { ...process.env, BOAT_PON_DB_PATH: dbPath },
      maxBuffer: 1024 * 1024,
    });
    const first = await run();
    const firstStatus = JSON.parse(first.stdout.trim()) as { settled: number; hits: number; misses: number; privateLearningRetained: boolean; productionChangeAllowed: boolean };
    assert.equal(firstStatus.settled, 3);
    assert.equal(firstStatus.hits, 1);
    assert.equal(firstStatus.misses, 2);
    assert.equal(firstStatus.privateLearningRetained, true);
    assert.equal(firstStatus.productionChangeAllowed, false);

    const summary = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    assert.deepEqual(validateBuyLearningSummary(summary), []);
    assert.equal(JSON.stringify(summary).includes("1-2-3"), false);
    assert.equal(JSON.stringify(summary).includes("currentOdds"), false);
    assert.equal((summary.performance as { settled: number }).settled, 3);
    // One 3.6x official payout across three unit stakes => 1.2 realized ROI proxy.
    assert.equal((summary.performance as { roi: number }).roi, 1.2);

    const files = await readdir(privateDir);
    assert.equal(files.length, 1);
    const privateFile = join(privateDir, files[0]!);
    assert.equal((await stat(privateDir)).mode & 0o777, 0o700);
    assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
    const retained = await readFile(privateFile, "utf8");
    assert.doesNotMatch(retained, /\/Users\/|\/home\/|api[_-]?token/i);

    const second = await run();
    const secondStatus = JSON.parse(second.stdout.trim()) as { privateLearningRetained: boolean };
    assert.equal(secondStatus.privateLearningRetained, false);
    assert.equal((await readdir(privateDir)).length, 1);
  } finally {
    await rm(output, { force: true });
    await rm(privateDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});
