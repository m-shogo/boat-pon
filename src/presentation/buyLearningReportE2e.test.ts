import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("BUY learning report derives sanitized outcomes and retains semantic evidence idempotently", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-learning-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-learning-e2e-${suffix}.json`;
  const privateDir = `data/private/buy-learning-e2e-${suffix}`;
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE decision_history (
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        decision TEXT NOT NULL,
        selection TEXT,
        result TEXT,
        returned INTEGER NOT NULL DEFAULT 0,
        current_odds REAL,
        estimated_hit_rate REAL,
        sample_size INTEGER,
        ev REAL,
        model_version TEXT,
        run_kind TEXT
      );
    `);
    const insert = db.prepare(`INSERT INTO decision_history
      (date,venue,race_no,decision,selection,result,returned,current_odds,estimated_hit_rate,sample_size,ev,model_version,run_kind)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run("2026-08-01", "A", 1, "BUY", "1-2-3", "1-2-3", 0, 2.4, 0.60, 80, 1.44, "v1", "paper-live");
    insert.run("2026-08-02", "A", 2, "BUY", "1-2-3", "1-3-2", 0, 4.2, 0.55, 20, 2.31, "v1", "paper-live");
    insert.run("2026-08-03", "B", 3, "BUY", "2-1-3", "3-1-2", 0, 3.0, 0.30, 100, 0.90, "v1", "paper-live");
    insert.run("2026-08-04", "B", 4, "WATCH", "1-2-3", "1-2-3", 0, 2.0, 0.50, 100, 1.00, "v1", "paper-live");
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
    assert.deepEqual(firstStatus, { settled: 3, hits: 1, misses: 2, privateLearningRetained: true, productionChangeAllowed: false });

    const summary = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    assert.deepEqual(validateBuyLearningSummary(summary), []);
    assert.equal(JSON.stringify(summary).includes("1-2-3"), false);
    assert.equal(JSON.stringify(summary).includes("currentOdds"), false);
    assert.equal((summary.performance as { settled: number }).settled, 3);

    const second = await run();
    const secondStatus = JSON.parse(second.stdout.trim()) as { privateLearningRetained: boolean };
    assert.equal(secondStatus.privateLearningRetained, false);

    const privateStats = await stat(privateDir);
    assert.equal(privateStats.isDirectory(), true);
  } finally {
    await rm(output, { force: true });
    await rm(privateDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});
