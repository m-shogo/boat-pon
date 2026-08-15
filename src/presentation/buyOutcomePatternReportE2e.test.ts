import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("BUY outcome pattern report uses paper-live official payouts and keeps exact segment keys private", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-pattern-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-pattern-e2e-${suffix}.json`;
  const privateDir = `data/private/buy-pattern-e2e-${suffix}`;
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE decision_history (
        decision TEXT NOT NULL,
        selection TEXT,
        result TEXT,
        returned INTEGER NOT NULL DEFAULT 0,
        payout_yen INTEGER,
        venue TEXT,
        model_version TEXT,
        estimated_hit_rate REAL,
        ev REAL,
        current_odds REAL,
        sample_size INTEGER,
        run_kind TEXT
      );
    `);
    const insert = db.prepare(`INSERT INTO decision_history
      (decision,selection,result,returned,payout_yen,venue,model_version,estimated_hit_rate,ev,current_odds,sample_size,run_kind)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

    for (let i = 0; i < 30; i += 1) {
      // Official payout is 2x although decision-time odds are deliberately low.
      insert.run("BUY", "1-2-3", "1-2-3", 0, 200, "VENUE_SUCCESS_PRIVATE", "v1", 0.4, 1.1, 0.5, 100, "paper-live");
      // Misses have an official race payout but contribute zero return to this BUY.
      insert.run("BUY", "1-2-3", "1-3-2", 0, 200, "VENUE_FAILURE_PRIVATE", "v1", 0.4, 1.1, 100.0, 100, "paper-live");
      // Huge historical hits must not affect the Current BUY baseline or signals.
      insert.run("BUY", "1-2-3", "1-2-3", 0, 10000, "VENUE_HISTORY_PRIVATE", "v0", 0.9, 90.0, 100.0, 500, "historical-backfill");
    }
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
      privatePatternCount: number;
      publicSignalCount: number;
      retained: boolean;
      productionChangeAllowed: boolean;
    };
    assert.equal(status.analyzedSettled, 60);
    assert.ok(status.privatePatternCount >= 2);
    assert.equal(status.publicSignalCount, 2);
    assert.equal(status.retained, true);
    assert.equal(status.productionChangeAllowed, false);

    const publicRecord = JSON.parse(await readFile(output, "utf8")) as {
      analyzedSettled: number;
      signals: Array<{ direction: string; dimension: string; roiDelta: number; productionChangeAllowed: boolean }>;
    };
    assert.equal(publicRecord.analyzedSettled, 60);
    assert.deepEqual(new Set(publicRecord.signals.map((signal) => signal.direction)), new Set(["SUCCESS_EDGE", "FAILURE_REGIME"]));
    assert.ok(publicRecord.signals.every((signal) => signal.dimension === "venue"));
    assert.ok(publicRecord.signals.every((signal) => Math.abs(signal.roiDelta) === 1));
    assert.ok(publicRecord.signals.every((signal) => signal.productionChangeAllowed === false));

    const publicText = JSON.stringify(publicRecord);
    assert.doesNotMatch(publicText, /VENUE_SUCCESS_PRIVATE|VENUE_FAILURE_PRIVATE|VENUE_HISTORY_PRIVATE/);
    assert.doesNotMatch(publicText, /segmentKey|selection|currentOdds|requiredOdds|stake/);

    const privateFiles = await readdir(privateDir);
    assert.equal(privateFiles.length, 1);
    const privateText = await readFile(join(privateDir, privateFiles[0]!), "utf8");
    assert.match(privateText, /VENUE_SUCCESS_PRIVATE/);
    assert.match(privateText, /VENUE_FAILURE_PRIVATE/);
    assert.doesNotMatch(privateText, /VENUE_HISTORY_PRIVATE/);
  } finally {
    await rm(output, { force: true });
    await rm(privateDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});
