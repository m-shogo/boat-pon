import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

function withDb(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-metrics-payout-lineage-"));
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
        parse_run_id TEXT NOT NULL,
        supersedes_id TEXT,
        correction_kind TEXT,
        correction_reason TEXT
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT NOT NULL,
        selection_normalized TEXT NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        refund_scope TEXT NOT NULL,
        refund_yen_per_100 INTEGER,
        reason_code TEXT NOT NULL
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

test("mismatched payout bet lineage cannot hide special-payout evidence from evaluation metrics", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-07:05:R1";
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      (observation_id,canonical_race_key,observation_type,payload_type,raw_document_id,parse_run_id,supersedes_id,correction_kind,correction_reason)
      VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a',NULL,NULL,NULL)`)
      .run(raceKey);
    db.prepare(`INSERT INTO settlement_candidates_v2
      (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,revision_kind,resolution_status,observation_id,parse_run_id,raw_document_id,semantic_hash,supersedes_candidate_id,correction_reason)
      VALUES ('a',?,'trifecta','settled','normal','initial','resolved','obs-a','parse-a','raw-a','semantic-a',NULL,NULL)`)
      .run(raceKey);
    db.prepare(`INSERT INTO race_payout_lines_v2
      (payout_line_id,candidate_id,line_no,bet_type,selection_raw,selection_normalized,selection_canonical,payout_yen,line_kind)
      VALUES ('normal-a','a',1,'trifecta','1-2-3','1-2-3','1-2-3',1230,'payout')`).run();
    db.prepare(`INSERT INTO race_payout_lines_v2
      (payout_line_id,candidate_id,line_no,bet_type,selection_raw,selection_normalized,selection_canonical,payout_yen,line_kind)
      VALUES ('forged-special-a','a',2,'exacta','1-2','1-2','1-2',70,'special_payout')`).run();
    db.close();

    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: [raceKey] });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(`${raceKey}:PAYOUT_BET_LINEAGE_MISMATCH:a`));
    assert.equal(report.settlementCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.networkRequestCount, 0);
  });
});
