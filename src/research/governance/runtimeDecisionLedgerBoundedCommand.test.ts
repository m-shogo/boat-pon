import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateRuntimeDecisionLedgerShadowEvidence } from "./runtimeDecisionLedgerShadowEvidence";

const scriptPath = fileURLToPath(
  new URL("../../../scripts/report-runtime-decision-ledger-shadow.ts", import.meta.url),
);

function createFixture(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
CREATE TABLE decision_history (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  estimated_hit_rate REAL NOT NULL,
  raw_estimated_hit_rate REAL,
  required_odds REAL NOT NULL,
  current_odds REAL,
  ev REAL,
  decision TEXT NOT NULL,
  recommended_stake_yen INTEGER NOT NULL,
  sample_size INTEGER NOT NULL,
  model_version TEXT,
  run_kind TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decision_reasons TEXT,
  feature_adjustment REAL,
  feature_adjustment_breakdown TEXT
);
CREATE TABLE official_programs (
  race_id TEXT PRIMARY KEY,
  close_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
`);
    db.prepare(`
INSERT INTO decision_history (
  id, race_id, date, venue, race_no, bet_type, selection,
  estimated_hit_rate, raw_estimated_hit_rate, required_odds, current_odds, ev,
  decision, recommended_stake_yen, sample_size, model_version, run_kind,
  source, fetched_at, created_at, decision_reasons, feature_adjustment,
  feature_adjustment_breakdown
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      1,
      "20260805-01-01",
      "2026-08-05",
      "桐生",
      1,
      "3連単",
      "1-2-3",
      0.2,
      0.21,
      5,
      6,
      1.2,
      "BUY",
      100,
      100,
      "v4-conservative",
      "paper-live",
      "fixture",
      "2026-08-05 05:26:00",
      "2026-08-05 05:26:30",
      '["fixture reason"]',
      null,
      null,
    );
    db.prepare(`
INSERT INTO official_programs (race_id, close_at, imported_at)
VALUES (?, ?, ?)
`).run("20260805-01-01", "15:00", "2026-08-05 05:00:00");
  } finally {
    db.close();
  }
}

function runCommand(
  dbPath: string,
  evidencePath: string,
  privateStoreDir: string,
): string {
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      scriptPath,
      "--db",
      dbPath,
      "--run-kind",
      "paper-live",
      "--model-version",
      "v4-conservative",
      "--from",
      "2026-08-05",
      "--to",
      "2026-08-05",
      "--limit",
      "10",
      "--evidence-output",
      evidencePath,
      "--private-store-dir",
      privateStoreDir,
    ],
    { encoding: "utf8" },
  );
}

test("bounded command writes sanitized evidence and idempotent private report", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-rdl-bounded-"));
  try {
    const dbPath = join(root, "fixture.sqlite");
    const evidencePath = join(root, "evidence.json");
    const privateStoreDir = join(root, "private");
    createFixture(dbPath);

    const stdout = runCommand(dbPath, evidencePath, privateStoreDir);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, any>;
    const validation = validateRuntimeDecisionLedgerShadowEvidence(evidence);
    assert.equal(validation.valid, true, validation.errors.join("; "));
    assert.equal(evidence.verdict, "PASS");
    assert.equal(evidence.reconciliation.sourceRows, 1);
    assert.equal(evidence.reconciliation.mappedUnique, 1);
    assert.equal(evidence.scope.limitReached, false);
    assert.equal(JSON.parse(stdout).contentDigest, evidence.contentDigest);

    const evidenceJson = JSON.stringify(evidence);
    assert.doesNotMatch(evidenceJson, /20260805-01-01|1-2-3|fixture\.sqlite|sourceDecisionHistoryId/);
    assert.equal(evidence.privacy.outcomeColumnsRead, false);
    assert.equal(evidence.safety.lineSends, 0);

    const firstFiles = readdirSync(privateStoreDir);
    assert.equal(firstFiles.length, 1);
    const privatePayload = JSON.parse(
      readFileSync(join(privateStoreDir, firstFiles[0]), "utf8"),
    ) as Record<string, any>;
    assert.equal(privatePayload.source.dbPath, dbPath);
    assert.equal(privatePayload.reconciliation.records.length, 1);
    assert.equal(privatePayload.reconciliation.records[0].canonicalRaceId, "20260805-01-01");

    runCommand(dbPath, evidencePath, privateStoreDir);
    assert.deepEqual(readdirSync(privateStoreDir), firstFiles);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
