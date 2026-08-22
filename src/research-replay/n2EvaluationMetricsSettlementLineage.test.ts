import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

function withDb(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-metrics-lineage-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
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
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
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
    try { db.close(); } catch { /* immutable reader may already close */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertObservation(db: DatabaseSync, input: {
  observationId: string;
  raceKey: string;
  parseRunId: string;
  rawDocumentId: string;
}): void {
  db.prepare("INSERT OR IGNORE INTO parse_runs VALUES (?,?,'success')")
    .run(input.parseRunId, input.rawDocumentId);
  db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,raw_document_id,parse_run_id,supersedes_id,correction_kind,correction_reason)
    VALUES (?,?,'settlement_result','settlement_result',?,?,NULL,NULL,NULL)`)
    .run(input.observationId, input.raceKey, input.rawDocumentId, input.parseRunId);
}

function insertCandidate(db: DatabaseSync, input: {
  candidateId: string;
  raceKey: string;
  observationId: string;
  parseRunId: string;
  rawDocumentId: string;
}): void {
  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,revision_kind,resolution_status,observation_id,parse_run_id,raw_document_id,semantic_hash,supersedes_candidate_id,correction_reason)
    VALUES (?,?,'trifecta','settled','normal','initial','resolved',?,?,?,'semantic',NULL,NULL)`)
    .run(input.candidateId, input.raceKey, input.observationId, input.parseRunId, input.rawDocumentId);
  db.prepare(`INSERT INTO race_payout_lines_v2
    (payout_line_id,candidate_id,line_no,bet_type,selection_canonical,payout_yen,line_kind)
    VALUES (?,?,1,'trifecta','1-2-3',1230,'payout')`)
    .run(`p-${input.candidateId}`, input.candidateId);
}

test("reader rejects a settlement candidate moved to a different observation race", () => {
  withDb((path, db) => {
    insertObservation(db, {
      observationId: "obs-a",
      raceKey: "2026-08-07:05:R1",
      parseRunId: "parse-a",
      rawDocumentId: "raw-a",
    });
    insertCandidate(db, {
      candidateId: "candidate-a",
      raceKey: "2026-08-07:05:R2",
      observationId: "obs-a",
      parseRunId: "parse-a",
      rawDocumentId: "raw-a",
    });
    db.close();

    const report = readN2EvaluationMetricsSettlements({
      sidecarDbPath: path,
      raceKeys: ["2026-08-07:05:R2"],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(
      "2026-08-07:05:R2:SETTLEMENT_LINEAGE_MISMATCH:obs-a",
    ));
    assert.equal(report.settlementCount, 0);
  });
});

test("reader rejects candidate parse/raw lineage that differs from its observation", () => {
  withDb((path, db) => {
    insertObservation(db, {
      observationId: "obs-a",
      raceKey: "2026-08-07:05:R1",
      parseRunId: "parse-a",
      rawDocumentId: "raw-a",
    });
    db.prepare("INSERT INTO parse_runs VALUES ('parse-b','raw-b','success')").run();
    insertCandidate(db, {
      candidateId: "candidate-a",
      raceKey: "2026-08-07:05:R1",
      observationId: "obs-a",
      parseRunId: "parse-b",
      rawDocumentId: "raw-b",
    });
    db.close();

    const report = readN2EvaluationMetricsSettlements({
      sidecarDbPath: path,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(
      "2026-08-07:05:R1:SETTLEMENT_LINEAGE_MISMATCH:obs-a",
    ));
    assert.equal(report.settlementCount, 0);
  });
});

test("reader rejects a non-settlement observation used as settlement evidence", () => {
  withDb((path, db) => {
    insertObservation(db, {
      observationId: "obs-a",
      raceKey: "2026-08-07:05:R1",
      parseRunId: "parse-a",
      rawDocumentId: "raw-a",
    });
    db.prepare(`UPDATE domain_observations
      SET observation_type='official_program', payload_type='official_program'
      WHERE observation_id='obs-a'`).run();
    insertCandidate(db, {
      candidateId: "candidate-a",
      raceKey: "2026-08-07:05:R1",
      observationId: "obs-a",
      parseRunId: "parse-a",
      rawDocumentId: "raw-a",
    });
    db.close();

    const report = readN2EvaluationMetricsSettlements({
      sidecarDbPath: path,
      raceKeys: ["2026-08-07:05:R1"],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(
      "2026-08-07:05:R1:SETTLEMENT_LINEAGE_MISMATCH:obs-a",
    ));
    assert.equal(report.settlementCount, 0);
  });
});
