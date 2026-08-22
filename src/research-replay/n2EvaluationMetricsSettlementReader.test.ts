import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  SOURCE_DUPLICATE_POLICY_VERSION,
  SOURCE_DUPLICATE_RESOLVER_VERSION,
  archiveFileForRaceKey,
} from "./n1CanonicalResolution";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION } from "./settlement";
import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

const DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

function withDb(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-metrics-settlement-"));
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
    try { db.close(); } catch { /* already closed for immutable read */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertClean(
  db: DatabaseSync,
  id: string,
  raceKey: string,
  selection: string,
  payoutYen: number,
  options: { rawDocumentId?: string; parseRunId?: string; semanticHash?: string } = {},
): void {
  const observationId = `obs-${id}`;
  const rawDocumentId = options.rawDocumentId ?? `raw-${id}`;
  const parseRunId = options.parseRunId ?? `parse-${id}`;
  const semanticHash = options.semanticHash ?? `semantic-${id}`;
  db.prepare("INSERT OR IGNORE INTO parse_runs VALUES (?,?,'success')").run(parseRunId, rawDocumentId);
  db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,raw_document_id,parse_run_id,supersedes_id,correction_kind,correction_reason)
    VALUES (?,?,'settlement_result','settlement_result',?,?,NULL,NULL,NULL)`)
    .run(observationId, raceKey, rawDocumentId, parseRunId);
  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,revision_kind,resolution_status,observation_id,parse_run_id,raw_document_id,semantic_hash,supersedes_candidate_id,correction_reason)
    VALUES (?,?, 'trifecta','settled','normal','initial','resolved',?,?,?,?,NULL,NULL)`)
    .run(id, raceKey, observationId, parseRunId, rawDocumentId, semanticHash);
  db.prepare(`INSERT INTO race_payout_lines_v2
    (payout_line_id,candidate_id,line_no,bet_type,selection_canonical,payout_yen,line_kind)
    VALUES (?,?,1,'trifecta',?,?,'payout')`)
    .run(`p-${id}`, id, selection, payoutYen);
}

function insertValidResolution(
  db: DatabaseSync,
  duplicateId: string,
  canonicalId: string,
  raceKey: string,
  rawDocumentId: string,
  semanticHash: string,
): void {
  const candidateDigest = canonicalHash([["trifecta", semanticHash]]);
  db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2
    (resolution_id,duplicate_observation_id,canonical_observation_id,canonical_race_key,raw_document_id,source_archive_file,resolution_kind,detection_reason,duplicate_semantic_digest,resolver_version,policy_version,schema_version)
    VALUES (?,?,?,?,?,?,'source_duplicate',?,?,?,?,?)`)
    .run(
      `resolution-${duplicateId}`,
      `obs-${duplicateId}`,
      `obs-${canonicalId}`,
      raceKey,
      rawDocumentId,
      archiveFileForRaceKey(raceKey),
      DETECTION_REASON,
      candidateDigest,
      SOURCE_DUPLICATE_RESOLVER_VERSION,
      SOURCE_DUPLICATE_POLICY_VERSION,
      N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
    );
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

test("currently valid source-duplicate resolution excludes the duplicate observation", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-07:05:R1";
    const rawDocumentId = "raw-shared";
    const parseRunId = "parse-shared";
    const semanticHash = "semantic-shared";
    insertClean(db, "canonical", raceKey, "1-2-3", 1230, { rawDocumentId, parseRunId, semanticHash });
    insertClean(db, "duplicate", raceKey, "1-2-3", 1230, { rawDocumentId, parseRunId, semanticHash });
    insertValidResolution(db, "duplicate", "canonical", raceKey, rawDocumentId, semanticHash);
    db.close();
    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: [raceKey] });
    assert.equal(report.status, "PASS");
    assert.equal(report.settlementCount, 1);
    assert.equal(report.settlements[0]?.canonicalRaceKey, raceKey);
  });
});

test("stale source-duplicate evidence blocks instead of silently suppressing or restoring settlement", () => {
  withDb((path, db) => {
    const raceKey = "2026-08-07:05:R1";
    insertClean(db, "a", raceKey, "1-2-3", 1230);
    db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2
      (resolution_id,duplicate_observation_id,canonical_observation_id,canonical_race_key,raw_document_id,source_archive_file,resolution_kind,detection_reason,duplicate_semantic_digest,resolver_version,policy_version,schema_version)
      VALUES ('stale','obs-a','missing-observation',?,'raw-a',?,'source_duplicate',?,'deadbeef',?,?,?)`)
      .run(
        raceKey,
        archiveFileForRaceKey(raceKey),
        DETECTION_REASON,
        SOURCE_DUPLICATE_RESOLVER_VERSION,
        SOURCE_DUPLICATE_POLICY_VERSION,
        N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
      );
    db.close();
    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: path, raceKeys: [raceKey] });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"));
    assert.equal(report.settlementCount, 0);
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
