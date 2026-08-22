import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EdgeHoldoutSource } from "./n2EdgeHoldoutSource";

function withDb(fn: (paths: { primary: string; sidecar: string }, dbs: { primary: DatabaseSync; sidecar: DatabaseSync }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "n2-holdout-settlement-lineage-"));
  const primaryPath = join(root, "primary.sqlite");
  const sidecarPath = join(root, "sidecar.sqlite");
  const primary = new DatabaseSync(primaryPath);
  const sidecar = new DatabaseSync(sidecarPath);
  primary.exec(`CREATE TABLE official_programs(
    race_id TEXT PRIMARY KEY,date TEXT,venue TEXT,race_no INTEGER,close_at TEXT,source_file TEXT,raw_json TEXT,imported_at TEXT
  );`);
  sidecar.exec(`
    CREATE TABLE parse_runs(parse_run_id TEXT PRIMARY KEY,raw_document_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE domain_observations(
      observation_id TEXT PRIMARY KEY,canonical_race_key TEXT NOT NULL,observation_type TEXT NOT NULL,payload_type TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,parse_run_id TEXT NOT NULL,supersedes_id TEXT,correction_kind TEXT,correction_reason TEXT
    );
    CREATE TABLE settlement_candidates_v2(
      candidate_id TEXT PRIMARY KEY,canonical_race_key TEXT,bet_type TEXT,settlement_status TEXT,result_kind TEXT,revision_kind TEXT,
      resolution_status TEXT,observation_id TEXT,parse_run_id TEXT,raw_document_id TEXT,semantic_hash TEXT,supersedes_candidate_id TEXT,correction_reason TEXT
    );
    CREATE TABLE race_payout_lines_v2(
      payout_line_id TEXT PRIMARY KEY,candidate_id TEXT,line_no INTEGER,bet_type TEXT,selection_canonical TEXT,payout_yen INTEGER,line_kind TEXT
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2(
      resolution_id TEXT PRIMARY KEY,duplicate_observation_id TEXT NOT NULL,canonical_observation_id TEXT NOT NULL,
      canonical_race_key TEXT NOT NULL,raw_document_id TEXT NOT NULL,source_archive_file TEXT NOT NULL,resolution_kind TEXT NOT NULL,
      detection_reason TEXT NOT NULL,duplicate_semantic_digest TEXT NOT NULL,resolver_version TEXT NOT NULL,policy_version TEXT NOT NULL,schema_version TEXT NOT NULL
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

function insertEvidence(db: DatabaseSync, input: {
  candidateRace: string;
  observationRace: string;
  parseStatus?: string;
}): void {
  db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a',?)").run(input.parseStatus ?? "success");
  db.prepare(`INSERT INTO domain_observations VALUES (
    'obs-a',?,'settlement_result','settlement_result','raw-a','parse-a',NULL,NULL,NULL
  )`).run(input.observationRace);
  db.prepare(`INSERT INTO settlement_candidates_v2 VALUES (
    'candidate-a',?,'trifecta','settled','normal','initial','resolved','obs-a','parse-a','raw-a','semantic',NULL,NULL
  )`).run(input.candidateRace);
  db.prepare(`INSERT INTO race_payout_lines_v2 VALUES (
    'payout-a','candidate-a',1,'trifecta','1-2-3',1000,'payout'
  )`).run();
}

test("holdout blocks cross-race settlement evidence before primary metadata reads", () => withDb((paths, dbs) => {
  insertEvidence(dbs.sidecar, {
    candidateRace: "2022-01-01:11:R1",
    observationRace: "2022-01-01:11:R2",
  });
  dbs.primary.close();
  dbs.sidecar.close();

  const report = readN2EdgeHoldoutSource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("2022-01-01:11:R1:SETTLEMENT_LINEAGE_MISMATCH:obs-a"));
  assert.equal(report.reads.primaryDatabaseReadCount, 0);
  assert.equal(report.candidateRaceCount, 0);
}));

test("holdout blocks settlement evidence from a failed parse run", () => withDb((paths, dbs) => {
  insertEvidence(dbs.sidecar, {
    candidateRace: "2022-01-01:11:R1",
    observationRace: "2022-01-01:11:R1",
    parseStatus: "error",
  });
  dbs.primary.close();
  dbs.sidecar.close();

  const report = readN2EdgeHoldoutSource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("2022-01-01:11:R1:SETTLEMENT_LINEAGE_MISMATCH:obs-a"));
  assert.equal(report.reads.primaryDatabaseReadCount, 0);
  assert.equal(report.historicalOutcomeCount, 0);
}));
