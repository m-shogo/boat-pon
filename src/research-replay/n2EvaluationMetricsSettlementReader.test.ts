import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

function withDb(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-metrics-settlement-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        supersedes_candidate_id TEXT
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        duplicate_observation_id TEXT NOT NULL
      );
    `);
    fn(path, db);
  } finally {
    try { db.close(); } catch { /* already closed for immutable read */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertClean(db: DatabaseSync, id: string, raceKey: string, selection: string, payoutYen: number): void {
  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,resolution_status,observation_id,supersedes_candidate_id)
    VALUES (?,?, 'trifecta','settled','normal','resolved',?,NULL)`)
    .run(id, raceKey, `obs-${id}`);
  db.prepare(`INSERT INTO race_payout_lines_v2
    (payout_line_id,candidate_id,line_no,bet_type,selection_canonical,payout_yen,line_kind)
    VALUES (?,?,1,'trifecta',?,?,'payout')`)
    .run(`p-${id}`, id, selection, payoutYen);
}

test("reader returns exactly one clean active normal trifecta payout per requested race", () => {
  withDb((path, db) => {
    insertClean(db, "a", "2026-08-07:05:R1", "1-2-3", 1230);
    insertClean(db, "b", "2026-08-07:05:R2", "2-1-3", 980);
    db.close();
    const report = readN2EvaluationMetricsSettlements({
      sidecarDbPath: path,
      raceKeys: ["2026-08-07:05:R2", "2026-08-07:05:R1"],
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.requestedRaceCount, 2);
    assert.equal(report.settlementCount, 2);
    assert.deepEqual(report.settlements, [
      { canonicalRaceKey: "2026-08-07:05:R1", winningSelection: "1-2-3", payoutYen: 1230 },
      { canonicalRaceKey: "2026-08-07:05:R2", winningSelection: "2-1-3", payoutYen: 980 },
    ]);
    assert.equal(report.databaseReadCount, 1);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.networkRequestCount, 0);
  });
});

test("source-duplicate candidate is excluded and causes fail-closed missing settlement", () => {
  withDb((path, db) => {
    insertClean(db, "a", "2026-08-07:05:R1", "1-2-3", 1230);
    db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?)").run("obs-a");
    db.close();
    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2026-08-07:05:R1:CLEAN_PAYOUT_ROW_COUNT_0"));
    assert.ok(report.blockers.includes("SETTLEMENT_COUNT:0/1"));
  });
});

test("special-payout candidate is excluded from normal economic evaluation", () => {
  withDb((path, db) => {
    insertClean(db, "a", "2026-08-07:05:R1", "1-2-3", 1230);
    db.prepare(`INSERT INTO race_payout_lines_v2
      (payout_line_id,candidate_id,line_no,bet_type,selection_canonical,payout_yen,line_kind)
      VALUES ('special-a','a',2,'trifecta','1-2-3',70,'special_payout')`).run();
    db.close();
    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: ["2026-08-07:05:R1"] });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2026-08-07:05:R1:CLEAN_PAYOUT_ROW_COUNT_0"));
  });
});

test("invalid or duplicate race-key request is rejected before opening the database", () => {
  const invalid = readN2EvaluationMetricsSettlements({
    sidecarDbPath: "/does/not/exist.sqlite",
    raceKeys: ["bad-key"],
  });
  assert.equal(invalid.status, "BLOCKED");
  assert.ok(invalid.blockers.includes("RACE_KEY_INVALID:bad-key"));
  assert.equal(invalid.databaseReadCount, 0);

  const duplicate = readN2EvaluationMetricsSettlements({
    sidecarDbPath: "/does/not/exist.sqlite",
    raceKeys: ["2026-08-07:05:R1", "2026-08-07:05:R1"],
  });
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.includes("DUPLICATE_RACE_KEY_REQUEST"));
  assert.equal(duplicate.databaseReadCount, 0);
});
