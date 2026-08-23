import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EdgeDiscoverySource } from "./n2EdgeDiscoverySource";

function withDatabases(
  fn: (paths: { primary: string; sidecar: string }, dbs: { primary: DatabaseSync; sidecar: DatabaseSync }) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-edge-discovery-raw-"));
  const primaryPath = join(root, "primary.sqlite");
  const sidecarPath = join(root, "sidecar.sqlite");
  const primary = new DatabaseSync(primaryPath);
  const sidecar = new DatabaseSync(sidecarPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      close_at TEXT NOT NULL,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
  sidecar.exec(`
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
  try {
    fn({ primary: primaryPath, sidecar: sidecarPath }, { primary, sidecar });
  } finally {
    try { primary.close(); } catch { /* already closed */ }
    try { sidecar.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertWinner(
  db: DatabaseSync,
  raw: { integrity: string; security: string; replayEligible: number },
): string {
  const raceKey = "2004-01-01:11:R1";
  db.prepare("INSERT INTO raw_documents VALUES ('raw-a',?,?,?)")
    .run(raw.integrity, raw.security, raw.replayEligible);
  db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
  db.prepare(`INSERT INTO domain_observations
    VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
  db.prepare(`INSERT INTO settlement_candidates_v2
    VALUES ('candidate-a',?,'trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL)`).run(raceKey);
  db.prepare(`INSERT INTO race_payout_lines_v2
    VALUES ('payout-a','candidate-a',1,'trifecta','1-2-3',1000,'payout')`).run();
  return raceKey;
}

test("tainted settlement raw evidence blocks discovery before primary reads", () => {
  for (const raw of [
    { integrity: "quarantined", security: "passed", replayEligible: 1 },
    { integrity: "verified", security: "quarantined", replayEligible: 1 },
    { integrity: "verified", security: "passed", replayEligible: 0 },
  ]) {
    withDatabases((paths, dbs) => {
      const raceKey = insertWinner(dbs.sidecar, raw);
      dbs.primary.close();
      dbs.sidecar.close();

      const report = readN2EdgeDiscoverySource({
        primaryDbPath: paths.primary,
        sidecarDbPath: paths.sidecar,
      });

      assert.equal(report.status, "BLOCKED");
      assert.ok(report.blockers.includes(`${raceKey}:SETTLEMENT_LINEAGE_INVALID`));
      assert.equal(report.reads.primaryDatabaseReadCount, 0);
      assert.equal(report.candidateRaceCount, 0);
    });
  }
});
