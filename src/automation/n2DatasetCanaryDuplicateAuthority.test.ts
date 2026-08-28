import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  preflightN2AllActiveSettlementLineage,
  preflightN2DatasetCanarySettlementLineage,
} from "./n2DatasetCanarySettlementGuard";

function withInvalidDuplicateAuthority(fn: (path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-dataset-duplicate-authority-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE raw_documents (raw_document_id TEXT PRIMARY KEY);
    CREATE TABLE parse_runs (parse_run_id TEXT PRIMARY KEY);
    CREATE TABLE domain_observations (observation_id TEXT PRIMARY KEY);
    CREATE TABLE settlement_candidates_v2 (candidate_id TEXT PRIMARY KEY);
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
  db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES
    ('resolution-invalid','obs-duplicate','obs-canonical','2024-06-05:12:R1','raw-a','k240605.lzh',
     'producer_impossible_kind','invalid','${"a".repeat(64)}','invalid','invalid','invalid')`).run();
  db.close();
  try {
    fn(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("dataset settlement preflights fail closed before invalid duplicate authority can hide candidates", () => {
  withInvalidDuplicateAuthority((path) => {
    const canary = preflightN2DatasetCanarySettlementLineage(path);
    assert.equal(canary.ok, false);
    assert.equal(canary.checkedCandidateCount, 0);
    assert.deepEqual(canary.blocks, ["DATASET_CANARY_SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);

    const active = preflightN2AllActiveSettlementLineage(path);
    assert.equal(active.ok, false);
    assert.equal(active.checkedCandidateCount, 0);
    assert.deepEqual(active.blocks, ["DATASET_ACTIVE_SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
  });
});
