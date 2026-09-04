import assert from "node:assert/strict";
import { closeSync, linkSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EdgeDiscoverySource } from "./n2EdgeDiscoverySource";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-discovery-identity-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function touch(path: string): void {
  closeSync(openSync(path, "w"));
}

function createEmptyValidSidecar(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE domain_observations (
        observation_id TEXT,
        canonical_race_key TEXT,
        observation_type TEXT,
        payload_type TEXT,
        parse_run_id TEXT,
        raw_document_id TEXT,
        supersedes_id TEXT,
        correction_kind TEXT,
        correction_reason TEXT
      );
      CREATE TABLE parse_runs (
        parse_run_id TEXT,
        raw_document_id TEXT,
        status TEXT
      );
      CREATE TABLE raw_documents (
        raw_document_id TEXT,
        integrity_status TEXT,
        security_scan_status TEXT,
        parser_replay_eligible INTEGER
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT,
        canonical_race_key TEXT,
        observation_id TEXT,
        parse_run_id TEXT,
        raw_document_id TEXT,
        bet_type TEXT,
        settlement_status TEXT,
        result_kind TEXT,
        resolution_status TEXT,
        supersedes_candidate_id TEXT
      );
      CREATE TABLE race_payout_lines_v2 (
        candidate_id TEXT,
        bet_type TEXT,
        line_kind TEXT,
        selection_canonical TEXT,
        selection_raw TEXT,
        selection_normalized TEXT,
        line_no INTEGER
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        resolution_id TEXT,
        duplicate_observation_id TEXT,
        canonical_observation_id TEXT,
        canonical_race_key TEXT,
        raw_document_id TEXT,
        source_archive_file TEXT,
        resolution_kind TEXT,
        detection_reason TEXT,
        duplicate_semantic_digest TEXT,
        resolver_version TEXT,
        policy_version TEXT,
        schema_version TEXT
      );
    `);
  } finally {
    db.close();
  }
}

function assertSidecarIdentityBlocked(sidecarDbPath: string): void {
  const result = readN2EdgeDiscoverySource({
    primaryDbPath: join(dirname(sidecarDbPath), "must-not-be-read.sqlite"),
    sidecarDbPath,
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["SIDECAR_DISCOVERY_DB_IDENTITY_INVALID"]);
  assert.equal(result.reads.sidecarDatabaseReadCount, 0);
  assert.equal(result.reads.primaryDatabaseReadCount, 0);
}

function assertPrimaryIdentityBlocked(root: string, primaryDbPath: string): void {
  const sidecar = join(root, "sidecar.sqlite");
  createEmptyValidSidecar(sidecar);
  const result = readN2EdgeDiscoverySource({ primaryDbPath, sidecarDbPath: sidecar });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["PRIMARY_DISCOVERY_DB_IDENTITY_INVALID"]);
  assert.equal(result.reads.sidecarDatabaseReadCount, 1);
  assert.equal(result.reads.primaryDatabaseReadCount, 0);
}

test("edge discovery rejects a sidecar leaf symlink before any database read", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const alias = join(root, "alias.sqlite");
    touch(real);
    symlinkSync(real, alias);
    assertSidecarIdentityBlocked(alias);
  });
});

test("edge discovery rejects a sidecar ancestor symlink before any database read", () => {
  withRoot((root) => {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    const real = join(realDir, "sidecar.sqlite");
    mkdirSync(realDir);
    touch(real);
    symlinkSync(realDir, aliasDir);
    assertSidecarIdentityBlocked(join(aliasDir, "sidecar.sqlite"));
  });
});

test("edge discovery rejects a hard-linked sidecar before any database read", () => {
  withRoot((root) => {
    const real = join(root, "real.sqlite");
    const linked = join(root, "linked.sqlite");
    touch(real);
    linkSync(real, linked);
    assertSidecarIdentityBlocked(linked);
  });
});

test("edge discovery rejects a primary leaf symlink before any primary database read", () => {
  withRoot((root) => {
    const real = join(root, "primary-real.sqlite");
    const alias = join(root, "primary-alias.sqlite");
    touch(real);
    symlinkSync(real, alias);
    assertPrimaryIdentityBlocked(root, alias);
  });
});

test("edge discovery rejects a primary ancestor symlink before any primary database read", () => {
  withRoot((root) => {
    const realDir = join(root, "primary-real");
    const aliasDir = join(root, "primary-alias");
    const real = join(realDir, "primary.sqlite");
    mkdirSync(realDir);
    touch(real);
    symlinkSync(realDir, aliasDir);
    assertPrimaryIdentityBlocked(root, join(aliasDir, "primary.sqlite"));
  });
});

test("edge discovery rejects a hard-linked primary before any primary database read", () => {
  withRoot((root) => {
    const real = join(root, "primary-real.sqlite");
    const linked = join(root, "primary-linked.sqlite");
    touch(real);
    linkSync(real, linked);
    assertPrimaryIdentityBlocked(root, linked);
  });
});
