import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateBuyLearningSummary } from "./buyLearningSummary";

const execFileAsync = promisify(execFile);

test("BUY learning report fails safe as NOT_AVAILABLE when paper-live has no economically settled BUY", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boat-pon-buy-learning-unavailable-"));
  const dbPath = join(temp, "boat.sqlite");
  const suffix = `${process.pid}-${Date.now()}`;
  const output = `data/tmp/buy-learning-unavailable-${suffix}.json`;
  const patternSignals = `data/tmp/buy-patterns-unavailable-${suffix}.json`;
  const privateDir = `data/private/buy-learning-unavailable-${suffix}`;
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
        payout_yen INTEGER,
        estimated_hit_rate REAL,
        sample_size INTEGER,
        ev REAL,
        model_version TEXT,
        run_kind TEXT
      );
    `);
    db.prepare(`INSERT INTO decision_history
      (date,venue,race_no,decision,selection,result,returned,current_odds,payout_yen,estimated_hit_rate,sample_size,ev,model_version,run_kind)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("2026-08-15", "A", 1, "BUY", "1-2-3", null, 0, 2.5, null, 0.45, 80, 1.12, "v1", "paper-live");
  } finally {
    db.close();
  }

  try {
    await mkdir(dirname(patternSignals), { recursive: true });
    await writeFile(patternSignals, `${JSON.stringify({
      schemaVersion: "buy-outcome-pattern-public-v1",
      productionChangeAllowed: false,
      signals: [],
    })}\n`, "utf8");

    const run = await execFileAsync("npx", [
      "tsx",
      "scripts/report-buy-learning-summary.ts",
      "--run-kind", "paper-live",
      "--recent", "30",
      "--pattern-signals", patternSignals,
      "--output", output,
      "--retain-private-dir", privateDir,
    ], {
      env: { ...process.env, BOAT_PON_DB_PATH: dbPath },
      maxBuffer: 1024 * 1024,
    });

    const status = JSON.parse(run.stdout.trim()) as {
      status: string;
      settled: number | null;
      hits: number | null;
      misses: number | null;
      learningCount: number;
      researchCandidateCount: number;
      privateLearningRetained: boolean;
      productionChangeAllowed: boolean;
    };
    assert.deepEqual(status, {
      status: "NOT_AVAILABLE",
      settled: null,
      hits: null,
      misses: null,
      learningCount: 0,
      researchCandidateCount: 0,
      privateLearningRetained: true,
      productionChangeAllowed: false,
      output,
    });

    const summary = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    assert.deepEqual(validateBuyLearningSummary(summary), []);
    assert.equal(summary.status, "NOT_AVAILABLE");
    assert.deepEqual(summary.performance, {
      totalDecisions: null,
      settled: null,
      hits: null,
      misses: null,
      hitRate: null,
      roi: null,
      roiExMax: null,
    });
    assert.deepEqual(summary.learnings, []);
    assert.deepEqual(summary.researchCandidates, []);
  } finally {
    await rm(output, { force: true });
    await rm(patternSignals, { force: true });
    await rm(privateDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});
