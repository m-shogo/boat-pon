import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readCleanTrifectaWinners } from "./n2HistoricalOnlyBaselineSource";

function withDb(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-historical-payout-lineage-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE raw_documents (
        raw_document_id TEXT PRIMARY KEY,
        integrity_status TEXT NOT NULL,
        security_scan_status TEXT NOT NULL,
        parser_replay_eligible INTEGER NOT NULL
      );
      CREATE TABLE parse_runs (
        parse_run_id TEXT PRIMARY KEY,
        raw_document_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE domain_observations (
        observation_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        payload_type TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        supersedes_candidate_id TEXT
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        resolution_id TEXT PRIMARY KEY,
        duplicate_observation_id TEXT NOT NULL,
        canonical_observation_id TEXT NOT NULL,
        canonical_race_key TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        source_archive_file TEXT NOT NULL,
        resolution_kind TEXT NOT NULL,
        detection_reason TEXT NOT NULL,
        duplicate_semantic_digest TEXT NOT NULL,
        resolver_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        schema_version TEXT NOT NULL
      );
    `);
    fn(path, db);
  } finally {
    try { db.close(); } catch { /* immutable reader may already be closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

test("historical winner reader rejects cross-bet payout lineage before building training outcomes", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-01:05:R1";
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('a',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL)`).run(raceKey);
    db.prepare(`INSERT INTO race_payout_lines_v2
      VALUES ('normal-a','a',1,'trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
    db.prepare(`INSERT INTO race_payout_lines_v2
      VALUES ('forged-special-a','a',2,'exacta','1-2','1-2','1-2','special_payout')`).run();
    db.close();

    const result = readCleanTrifectaWinners({
      sidecarDbPath: path,
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
    });
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      `${raceKey}:PAYOUT_BET_LINEAGE_MISMATCH:a`,
    ]);
  });
});

test("historical winner reader fails closed when a cross-race successor would hide training evidence", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-01:05:R1";
    const otherRaceKey = "2026-08-02:05:R1";
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('a',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL)`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('forged-successor',?,'trifecta','pending','normal','unresolved','obs-a','parse-a','raw-a','a')`).run(otherRaceKey);
    db.prepare(`INSERT INTO race_payout_lines_v2
      VALUES ('normal-a','a',1,'trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
    db.close();

    const result = readCleanTrifectaWinners({
      sidecarDbPath: path,
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
    });
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      `${raceKey}:SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:forged-successor`,
    ]);
  });
});

test("historical winner reader fails closed when an in-range candidate supersedes a predecessor outside the training window", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-01:05:R1";
    const priorRaceKey = "2026-07-31:05:R1";
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('prior',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL)`).run(priorRaceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('a',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a','prior')`).run(raceKey);
    db.prepare(`INSERT INTO race_payout_lines_v2
      VALUES ('normal-a','a',1,'trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
    db.close();

    const result = readCleanTrifectaWinners({
      sidecarDbPath: path,
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
    });
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      `${raceKey}:SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:a`,
    ]);
  });
});

test("historical winner reader fails closed when a same-race supersession cycle would hide training evidence", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-01:05:R1";
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('a',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a','b')`).run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('b',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a','a')`).run(raceKey);
    db.prepare(`INSERT INTO race_payout_lines_v2
      VALUES ('normal-a','a',1,'trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
    db.close();

    const result = readCleanTrifectaWinners({
      sidecarDbPath: path,
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
    });
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      `${raceKey}:SETTLEMENT_SUPERSESSION_CYCLE_INVALID:a`,
    ]);
  });
});