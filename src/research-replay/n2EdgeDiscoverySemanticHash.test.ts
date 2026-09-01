import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EdgeDiscoverySource } from "./n2EdgeDiscoverySource";

const RACE_KEY = "2004-08-01:05:R1";

test("edge discovery reader rejects a current settlement with a tampered semantic hash before primary reads", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-discovery-semantic-hash-"));
  const sidecar = join(root, "research.sqlite");
  const db = new DatabaseSync(sidecar);
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
        source_kind TEXT NOT NULL,
        source_schema_version TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
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
        popularity INTEGER,
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

    const observationId = "obs-candidate";
    const parseRunId = "parse-candidate";
    const rawDocumentId = "raw-candidate";
    db.prepare("INSERT INTO raw_documents VALUES (?, 'verified', 'passed', 1)").run(rawDocumentId);
    db.prepare("INSERT INTO parse_runs VALUES (?, ?, 'success')").run(parseRunId, rawDocumentId);
    db.prepare(`
      INSERT INTO domain_observations VALUES (?, ?, 'settlement_result', 'settlement_result', ?, ?, NULL, NULL, NULL)
    `).run(observationId, RACE_KEY, rawDocumentId, parseRunId);
    db.prepare(`
      INSERT INTO settlement_candidates_v2 VALUES (
        ?, ?, 'trifecta', 'settled', 'normal', 'initial', 'resolved',
        'official_result', 'n1-settlement.0.1', ?, ?, ?, ?, NULL, NULL, ?, ?
      )
    `).run(
      "candidate",
      RACE_KEY,
      observationId,
      parseRunId,
      rawDocumentId,
      "0".repeat(64),
      "2004-08-01T04:00:00.000Z",
      "2004-08-01T04:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO race_payout_lines_v2 VALUES (?, ?, 1, 'trifecta', '1-2-3', '1-2-3', '1-2-3', 1000, 1, 'payout')
    `).run("payout-candidate", "candidate");
  } finally {
    db.close();
  }

  try {
    const result = readN2EdgeDiscoverySource({
      primaryDbPath: join(root, "missing-primary.sqlite"),
      sidecarDbPath: sidecar,
    });

    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.blockers, [
      `${RACE_KEY}:SETTLEMENT_SEMANTIC_HASH_INVALID:candidate`,
    ]);
    assert.equal(result.reads.primaryDatabaseReadCount, 0);
    assert.equal(result.reads.sidecarDatabaseReadCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
